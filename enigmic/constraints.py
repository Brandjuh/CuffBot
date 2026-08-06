"""Three-valued clue evaluation and precomputed case geometry.

Clues are evaluated against *partial* assignments using Kleene three-valued
logic: a clue is ``TRUE`` or ``FALSE`` only when the placed characters already
determine its outcome; otherwise it is ``UNKNOWN``.  The solver may prune a
search branch only on ``FALSE`` — ``UNKNOWN`` must never be treated as false.

This module is pure stdlib and must never import discord or redbot.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Callable, Mapping

from .constants import ClueType
from .coordinates import (
    Cell,
    is_directly_east_of,
    is_directly_north_of,
    is_directly_south_of,
    is_directly_west_of,
    is_east_of,
    is_north_of,
    is_orthogonally_adjacent,
    is_south_of,
    is_west_of,
    iter_cells,
    normalize_edge,
    orthogonal_neighbors,
)
from .models import Case, Clue


class Tri(Enum):
    """Kleene three-valued truth value."""

    TRUE = "true"
    FALSE = "false"
    UNKNOWN = "unknown"


def tri_not(value: Tri) -> Tri:
    if value is Tri.TRUE:
        return Tri.FALSE
    if value is Tri.FALSE:
        return Tri.TRUE
    return Tri.UNKNOWN


def _from_bool(value: bool) -> Tri:
    return Tri.TRUE if value else Tri.FALSE


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CaseGeometry:
    """Precomputed spatial lookups for one case.

    Built once per case and shared by the solver, validator, hint engine,
    and renderer.  Adjacency (`beside`) is orthogonal adjacency with explicit
    wall edges removed; walls never affect the general direction predicates.
    """

    size: int
    walkable: frozenset[Cell]
    room_of: Mapping[Cell, str]
    cells_of_room: Mapping[str, frozenset[Cell]]
    walls: frozenset[tuple[Cell, Cell]]
    adjacency: Mapping[Cell, frozenset[Cell]]
    object_cells: Mapping[str, Cell]
    features_of: Mapping[Cell, tuple[str, ...]]

    @classmethod
    def from_case(cls, case: Case) -> "CaseGeometry":
        size = case.size
        blocked = case.all_blocked_cells
        walkable = frozenset(c for c in iter_cells(size) if c not in blocked)

        room_of: dict[Cell, str] = {}
        cells_of_room: dict[str, frozenset[Cell]] = {}
        for room in case.rooms:
            cells_of_room[room.id] = room.cells
            for cell in room.cells:
                room_of[cell] = room.id

        adjacency: dict[Cell, frozenset[Cell]] = {}
        for cell in iter_cells(size):
            neighbors = frozenset(
                other
                for other in orthogonal_neighbors(cell, size)
                if normalize_edge(cell, other) not in case.walls
            )
            adjacency[cell] = neighbors

        return cls(
            size=size,
            walkable=walkable,
            room_of=room_of,
            cells_of_room=cells_of_room,
            walls=case.walls,
            adjacency=adjacency,
            object_cells={obj.id: obj.cell for obj in case.objects},
            features_of=dict(case.cell_features),
        )

    def beside(self, a: Cell, b: Cell) -> bool:
        """``True`` when the two cells share an edge that no wall blocks."""
        return b in self.adjacency.get(a, frozenset())

    def same_room(self, a: Cell, b: Cell) -> bool:
        room_a = self.room_of.get(a)
        return room_a is not None and room_a == self.room_of.get(b)

    def cells_with_feature(self, feature: str) -> frozenset[Cell]:
        return frozenset(
            cell for cell, names in self.features_of.items() if feature in names
        )


# ---------------------------------------------------------------------------
# Evaluators
# ---------------------------------------------------------------------------

Assignment = Mapping[str, Cell]
Evaluator = Callable[[Clue, Assignment, CaseGeometry], Tri]

EVALUATORS: dict[ClueType, Evaluator] = {}


def _evaluator(kind: ClueType) -> Callable[[Evaluator], Evaluator]:
    """Register an evaluator for ``kind`` in the dispatch table."""

    def register(func: Evaluator) -> Evaluator:
        EVALUATORS[kind] = func
        return func

    return register


def evaluate(clue: Clue, assignment: Assignment, geometry: CaseGeometry) -> Tri:
    """Evaluate ``clue`` against a (possibly partial) assignment."""
    return EVALUATORS[clue.kind](clue, assignment, geometry)


# -- position clues ---------------------------------------------------------


@_evaluator(ClueType.IN_ROOM)
def _in_room(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
    cell = assignment.get(clue.owner)
    if cell is None:
        return Tri.UNKNOWN
    return _from_bool(geo.room_of.get(cell) == clue.params["room_id"])


@_evaluator(ClueType.NOT_IN_ROOM)
def _not_in_room(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
    return tri_not(_in_room(clue, assignment, geo))


@_evaluator(ClueType.IN_ROW)
def _in_row(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
    cell = assignment.get(clue.owner)
    if cell is None:
        return Tri.UNKNOWN
    return _from_bool(cell[0] == clue.params["row"])


@_evaluator(ClueType.NOT_IN_ROW)
def _not_in_row(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
    return tri_not(_in_row(clue, assignment, geo))


@_evaluator(ClueType.IN_COLUMN)
def _in_column(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
    cell = assignment.get(clue.owner)
    if cell is None:
        return Tri.UNKNOWN
    return _from_bool(cell[1] == clue.params["column"])


@_evaluator(ClueType.NOT_IN_COLUMN)
def _not_in_column(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
    return tri_not(_in_column(clue, assignment, geo))


@_evaluator(ClueType.ON_FEATURE)
def _on_feature(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
    cell = assignment.get(clue.owner)
    if cell is None:
        return Tri.UNKNOWN
    return _from_bool(clue.params["feature"] in geo.features_of.get(cell, ()))


@_evaluator(ClueType.NOT_ON_FEATURE)
def _not_on_feature(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
    return tri_not(_on_feature(clue, assignment, geo))


# -- character relationship clues -------------------------------------------


def _pair(clue: Clue, assignment: Assignment) -> tuple[Cell, Cell] | None:
    """Return (owner_cell, target_cell) when both characters are placed."""
    owner_cell = assignment.get(clue.owner)
    target_cell = assignment.get(clue.params["character_id"])
    if owner_cell is None or target_cell is None:
        return None
    return owner_cell, target_cell


def _character_relation(
    predicate: Callable[[CaseGeometry, Cell, Cell], bool],
) -> Evaluator:
    def evaluate_pair(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
        cells = _pair(clue, assignment)
        if cells is None:
            return Tri.UNKNOWN
        return _from_bool(predicate(geo, *cells))

    return evaluate_pair


EVALUATORS[ClueType.BESIDE_CHARACTER] = _character_relation(
    lambda geo, a, b: geo.beside(a, b)
)
EVALUATORS[ClueType.NOT_BESIDE_CHARACTER] = _character_relation(
    lambda geo, a, b: not geo.beside(a, b)
)
EVALUATORS[ClueType.NORTH_OF_CHARACTER] = _character_relation(
    lambda geo, a, b: is_north_of(a, b)
)
EVALUATORS[ClueType.SOUTH_OF_CHARACTER] = _character_relation(
    lambda geo, a, b: is_south_of(a, b)
)
EVALUATORS[ClueType.EAST_OF_CHARACTER] = _character_relation(
    lambda geo, a, b: is_east_of(a, b)
)
EVALUATORS[ClueType.WEST_OF_CHARACTER] = _character_relation(
    lambda geo, a, b: is_west_of(a, b)
)
EVALUATORS[ClueType.DIRECTLY_NORTH_OF_CHARACTER] = _character_relation(
    lambda geo, a, b: is_directly_north_of(a, b)
)
EVALUATORS[ClueType.DIRECTLY_SOUTH_OF_CHARACTER] = _character_relation(
    lambda geo, a, b: is_directly_south_of(a, b)
)
EVALUATORS[ClueType.DIRECTLY_EAST_OF_CHARACTER] = _character_relation(
    lambda geo, a, b: is_directly_east_of(a, b)
)
EVALUATORS[ClueType.DIRECTLY_WEST_OF_CHARACTER] = _character_relation(
    lambda geo, a, b: is_directly_west_of(a, b)
)
EVALUATORS[ClueType.SAME_ROOM_AS_CHARACTER] = _character_relation(
    lambda geo, a, b: geo.same_room(a, b)
)
EVALUATORS[ClueType.DIFFERENT_ROOM_FROM_CHARACTER] = _character_relation(
    lambda geo, a, b: not geo.same_room(a, b)
)


# -- object relationship clues ----------------------------------------------


def _object_relation(
    predicate: Callable[[CaseGeometry, Cell, Cell], bool],
) -> Evaluator:
    def evaluate_object(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
        owner_cell = assignment.get(clue.owner)
        if owner_cell is None:
            return Tri.UNKNOWN
        object_cell = geo.object_cells.get(clue.params["object_id"])
        if object_cell is None:
            # Unknown object references are a validation error; treat as
            # undecidable rather than crashing mid-game.
            return Tri.UNKNOWN
        return _from_bool(predicate(geo, owner_cell, object_cell))

    return evaluate_object


EVALUATORS[ClueType.BESIDE_OBJECT] = _object_relation(
    lambda geo, a, b: geo.beside(a, b)
)
EVALUATORS[ClueType.NOT_BESIDE_OBJECT] = _object_relation(
    lambda geo, a, b: not geo.beside(a, b)
)
EVALUATORS[ClueType.NORTH_OF_OBJECT] = _object_relation(
    lambda geo, a, b: is_north_of(a, b)
)
EVALUATORS[ClueType.SOUTH_OF_OBJECT] = _object_relation(
    lambda geo, a, b: is_south_of(a, b)
)
EVALUATORS[ClueType.EAST_OF_OBJECT] = _object_relation(
    lambda geo, a, b: is_east_of(a, b)
)
EVALUATORS[ClueType.WEST_OF_OBJECT] = _object_relation(
    lambda geo, a, b: is_west_of(a, b)
)
EVALUATORS[ClueType.IN_SAME_ROOM_AS_OBJECT] = _object_relation(
    lambda geo, a, b: geo.same_room(a, b)
)
EVALUATORS[ClueType.NOT_IN_SAME_ROOM_AS_OBJECT] = _object_relation(
    lambda geo, a, b: not geo.same_room(a, b)
)


# -- compound clues ---------------------------------------------------------


def _child_results(
    clue: Clue, assignment: Assignment, geo: CaseGeometry
) -> tuple[int, int, int]:
    """Count TRUE / FALSE / UNKNOWN results across the child constraints."""
    true = false = unknown = 0
    for child in clue.children:
        result = evaluate(child, assignment, geo)
        if result is Tri.TRUE:
            true += 1
        elif result is Tri.FALSE:
            false += 1
        else:
            unknown += 1
    return true, false, unknown


@_evaluator(ClueType.ALL_OF)
def _all_of(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
    true, false, unknown = _child_results(clue, assignment, geo)
    if false:
        return Tri.FALSE
    if unknown:
        return Tri.UNKNOWN
    return Tri.TRUE


@_evaluator(ClueType.ANY_OF)
def _any_of(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
    true, false, unknown = _child_results(clue, assignment, geo)
    if true:
        return Tri.TRUE
    if unknown:
        return Tri.UNKNOWN
    return Tri.FALSE


@_evaluator(ClueType.EXACTLY_ONE_OF)
def _exactly_one_of(clue: Clue, assignment: Assignment, geo: CaseGeometry) -> Tri:
    true, false, unknown = _child_results(clue, assignment, geo)
    if true >= 2:
        return Tri.FALSE
    if unknown == 0:
        return _from_bool(true == 1)
    # One TRUE with unknowns left could still gain a second TRUE, and zero
    # TRUE with unknowns left could still gain its single TRUE.
    return Tri.UNKNOWN


# Sanity check: every clue type must have exactly one registered evaluator.
_missing = [kind for kind in ClueType if kind not in EVALUATORS]
if _missing:  # pragma: no cover - guards against future edits
    raise RuntimeError(f"Missing clue evaluators: {_missing}")


def clues_touching(case: Case) -> dict[str, list[Clue]]:
    """Map each character ID to the clues whose scope mentions it.

    The solver re-evaluates only the clues touching the character it just
    placed, so this index is computed once per case.
    """
    index: dict[str, list[Clue]] = {c.id: [] for c in case.characters}
    for clue in case.clues:
        for char_id in clue.scope:
            if char_id in index:
                index[char_id].append(clue)
    return index
