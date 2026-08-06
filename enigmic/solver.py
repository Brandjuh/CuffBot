"""Backtracking constraint solver with uniqueness checking.

The solver independently searches for every arrangement that satisfies the
case rules (row/column uniqueness, walkable cells, all clues, the murderer
rule) and stops after finding ``max_solutions`` of them.  It never consults
the stored solution, so uniqueness is proven by search rather than by
comparison.

Implementation notes
--------------------
* Cell sets are represented as integer bitmasks (bit ``row * size + col``),
  which keeps domain intersection and counting cheap for boards up to 8x8.
* Clues whose scope is a single character are folded into that character's
  static domain before the search and skipped afterwards.
* Multi-character clues are re-evaluated only when a character in their
  scope is placed, using three-valued logic: a branch is pruned only when a
  clue evaluates to FALSE - UNKNOWN never rejects.
* The murderer rule (the victim's room must contain exactly one suspect) is
  enforced as a built-in pruner, not as a clue.

This module is pure stdlib and must never import discord or redbot.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum

from .constants import SOLVER_NODE_LIMIT, SOLVER_TIME_LIMIT, Role
from .constraints import CaseGeometry, Tri, evaluate
from .coordinates import Cell, format_coordinate
from .models import Case, Clue


class SolverStatus(Enum):
    """Outcome of a solver run."""

    NO_SOLUTION = "no_solution"
    UNIQUE_SOLUTION = "unique_solution"
    MULTIPLE_SOLUTIONS = "multiple_solutions"
    TIMEOUT = "timeout"


@dataclass
class SolverResult:
    """Result of one solver run."""

    status: SolverStatus
    solutions_found: int
    first_solution: dict[str, str] | None
    nodes_visited: int
    elapsed_seconds: float
    all_solutions: list[dict[str, Cell]] = field(default_factory=list)


class _BudgetExceeded(Exception):
    """Internal signal that the node or time budget ran out."""


class _Search:
    """One backtracking search over a case."""

    _TIME_CHECK_INTERVAL = 256

    def __init__(
        self,
        case: Case,
        geometry: CaseGeometry,
        *,
        max_solutions: int,
        node_limit: int,
        time_limit: float,
    ) -> None:
        self.case = case
        self.geo = geometry
        self.size = case.size
        self.max_solutions = max_solutions
        self.node_limit = node_limit
        self.deadline = time.monotonic() + time_limit
        self.nodes = 0

        size = self.size
        self.row_masks = [0] * size
        self.col_masks = [0] * size
        for row in range(size):
            for col in range(size):
                bit = 1 << (row * size + col)
                self.row_masks[row] |= bit
                self.col_masks[col] |= bit
        self.full_mask = (1 << (size * size)) - 1
        self.walkable_mask = self._mask(geometry.walkable)
        self.room_masks = {
            room_id: self._mask(cells)
            for room_id, cells in geometry.cells_of_room.items()
        }

        self.char_ids = [c.id for c in case.characters]
        self.victim_id = case.victim_id
        self.suspect_ids = frozenset(
            c.id for c in case.characters if c.role is Role.SUSPECT
        )

        # Split clues into unary (folded into static domains) and multi
        # (checked during search whenever a scoped character is placed).
        self.multi_clues: dict[str, list[Clue]] = {cid: [] for cid in self.char_ids}
        unary: dict[str, list[Clue]] = {cid: [] for cid in self.char_ids}
        for clue in case.clues:
            scope = [cid for cid in clue.scope if cid in self.multi_clues]
            if len(scope) <= 1:
                unary.setdefault(clue.owner, []).append(clue)
            else:
                for cid in scope:
                    self.multi_clues[cid].append(clue)

        self.static_domains: dict[str, int] = {}
        for cid in self.char_ids:
            domain = self.walkable_mask
            for clue in unary.get(cid, ()):
                domain = self._fold_unary(clue, cid, domain)
            self.static_domains[cid] = domain

        # Search state.
        self.assignment: dict[str, Cell] = {}
        self.used_rows = 0
        self.used_cols = 0
        self.solutions: list[dict[str, Cell]] = []

    # -- helpers ------------------------------------------------------------

    def _mask(self, cells) -> int:
        size = self.size
        mask = 0
        for row, col in cells:
            mask |= 1 << (row * size + col)
        return mask

    def _iter_cells(self, mask: int):
        size = self.size
        while mask:
            low = mask & -mask
            index = low.bit_length() - 1
            yield (index // size, index % size)
            mask ^= low

    def _fold_unary(self, clue: Clue, char_id: str, domain: int) -> int:
        """Remove cells where a single-character clue evaluates to FALSE."""
        result = domain
        for cell in self._iter_cells(domain):
            if evaluate(clue, {char_id: cell}, self.geo) is Tri.FALSE:
                result &= ~(1 << (cell[0] * self.size + cell[1]))
        return result

    def _avail_mask(self) -> int:
        """Cells whose row and column are both still free."""
        blocked = 0
        for row in range(self.size):
            if self.used_rows & (1 << row):
                blocked |= self.row_masks[row]
        for col in range(self.size):
            if self.used_cols & (1 << col):
                blocked |= self.col_masks[col]
        return self.full_mask & ~blocked

    def _victim_room_state(self) -> tuple[str | None, int]:
        """Return (victim's room id or None, suspects placed in that room)."""
        victim_cell = self.assignment.get(self.victim_id)
        if victim_cell is None:
            return None, 0
        room_id = self.geo.room_of.get(victim_cell)
        if room_id is None:
            return None, 0
        count = sum(
            1
            for cid, cell in self.assignment.items()
            if cid in self.suspect_ids and self.geo.room_of.get(cell) == room_id
        )
        return room_id, count

    def _murderer_rule_ok(self, avail: int) -> bool:
        """Prune branches that can no longer satisfy the murderer rule."""
        room_id, count = self._victim_room_state()
        if room_id is None:
            return True  # victim unplaced (or in no room - a validation error)
        if count >= 2:
            return False
        unplaced = [cid for cid in self.char_ids if cid not in self.assignment]
        if not unplaced:
            return count == 1
        if count == 0:
            room_avail = self.room_masks.get(room_id, 0) & avail
            if not any(
                self.static_domains[cid] & room_avail
                for cid in unplaced
                if cid in self.suspect_ids
            ):
                return False
        return True

    def _clues_ok(self, char_id: str) -> bool:
        """Check the multi-character clues touching a just-placed character."""
        for clue in self.multi_clues[char_id]:
            if evaluate(clue, self.assignment, self.geo) is Tri.FALSE:
                return False
        return True

    def _tick(self) -> None:
        self.nodes += 1
        if self.nodes > self.node_limit:
            raise _BudgetExceeded
        if self.nodes % self._TIME_CHECK_INTERVAL == 0 and time.monotonic() > self.deadline:
            raise _BudgetExceeded

    # -- placement ----------------------------------------------------------

    def try_place(self, char_id: str, cell: Cell) -> bool:
        """Place a character if structurally legal and no clue turns FALSE.

        Returns ``True`` on success; the caller must later :meth:`unplace`.
        Returns ``False`` (leaving state untouched) when the placement is
        immediately rejected.
        """
        row, col = cell
        if not (0 <= row < self.size and 0 <= col < self.size):
            # Off-board fixed placements are simply unsatisfiable; solve() is
            # documented to report NO_SOLUTION rather than raise for these.
            return False
        bit = 1 << (row * self.size + col)
        if not (self.static_domains[char_id] & bit):
            return False
        if self.used_rows & (1 << row) or self.used_cols & (1 << col):
            return False
        self.assignment[char_id] = cell
        self.used_rows |= 1 << row
        self.used_cols |= 1 << col
        if not self._clues_ok(char_id) or not self._murderer_rule_ok(self._avail_mask()):
            self.unplace(char_id)
            return False
        return True

    def unplace(self, char_id: str) -> None:
        row, col = self.assignment.pop(char_id)
        self.used_rows &= ~(1 << row)
        self.used_cols &= ~(1 << col)

    # -- search -------------------------------------------------------------

    def run(self) -> None:
        self._recurse()

    def _recurse(self) -> None:
        if len(self.solutions) >= self.max_solutions:
            return
        unplaced = [cid for cid in self.char_ids if cid not in self.assignment]
        if not unplaced:
            if self._verify_full_assignment():
                self.solutions.append(dict(self.assignment))
            return

        avail = self._avail_mask()
        # MRV: the character with the fewest candidate cells; prefer the
        # victim on ties so the murderer rule starts pruning early.
        def mrv_key(cid: str) -> tuple[int, int]:
            candidates = self.static_domains[cid] & avail
            return (candidates.bit_count(), 0 if cid == self.victim_id else 1)

        char_id = min(unplaced, key=mrv_key)
        candidates = self.static_domains[char_id] & avail
        if candidates == 0:
            return
        for cell in self._iter_cells(candidates):
            self._tick()
            if self.try_place(char_id, cell):
                self._recurse()
                self.unplace(char_id)
            if len(self.solutions) >= self.max_solutions:
                return

    def _verify_full_assignment(self) -> bool:
        """Defense in depth: re-check every clue and the murderer rule."""
        for clue in self.case.clues:
            if evaluate(clue, self.assignment, self.geo) is not Tri.TRUE:
                return False
        _, count = self._victim_room_state()
        return count == 1


def solve(
    case: Case,
    *,
    geometry: CaseGeometry | None = None,
    fixed: dict[str, Cell] | None = None,
    max_solutions: int = 2,
    node_limit: int = SOLVER_NODE_LIMIT,
    time_limit: float = SOLVER_TIME_LIMIT,
) -> SolverResult:
    """Search for arrangements satisfying every case rule.

    ``fixed`` pins characters to specific cells (used by the hint system to
    reason about the player's current placements).  A fixed placement that is
    itself illegal simply yields zero solutions rather than an error.

    The search stops after ``max_solutions`` solutions, after ``node_limit``
    nodes, or after ``time_limit`` seconds, whichever comes first.
    """
    start = time.monotonic()
    geo = geometry if geometry is not None else CaseGeometry.from_case(case)
    search = _Search(
        case,
        geo,
        max_solutions=max_solutions,
        node_limit=node_limit,
        time_limit=time_limit,
    )

    status: SolverStatus | None = None
    placed_fixed: list[str] = []
    valid_ids = set(search.char_ids)
    for char_id, cell in (fixed or {}).items():
        if char_id not in valid_ids or not search.try_place(char_id, cell):
            status = SolverStatus.NO_SOLUTION
            break
        placed_fixed.append(char_id)

    if status is None:
        try:
            search.run()
        except _BudgetExceeded:
            status = SolverStatus.TIMEOUT
        else:
            if len(search.solutions) == 0:
                status = SolverStatus.NO_SOLUTION
            elif len(search.solutions) == 1:
                status = SolverStatus.UNIQUE_SOLUTION
            else:
                status = SolverStatus.MULTIPLE_SOLUTIONS

    first = None
    if search.solutions:
        first = {
            cid: format_coordinate(cell)
            for cid, cell in sorted(search.solutions[0].items())
        }
    return SolverResult(
        status=status,
        solutions_found=len(search.solutions),
        first_solution=first,
        nodes_visited=search.nodes,
        elapsed_seconds=time.monotonic() - start,
        all_solutions=search.solutions,
    )
