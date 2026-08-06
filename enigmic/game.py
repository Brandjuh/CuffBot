"""Pure game-state logic: placements, marks, undo, submission, and hints.

Every function here mutates or inspects an :class:`ActiveGame` without any
Discord involvement, so the whole gameplay core is unit-testable.  User-facing
strings raised through :class:`InvalidMove` are complete English sentences.

This module is pure stdlib and must never import discord or redbot.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Sequence

from .constants import (
    HINT_SOLUTION_LIMIT,
    UNDO_HISTORY_LIMIT,
    HintLevel,
    Role,
)
from .constraints import CaseGeometry
from .coordinates import Cell, format_coordinate
from .errors import InvalidMove
from .models import ActiveGame, Case
from .solver import SolverStatus, solve


# ---------------------------------------------------------------------------
# Undo history
# ---------------------------------------------------------------------------


def _push_history(game: ActiveGame, entry: dict) -> None:
    game.history.append(entry)
    if len(game.history) > UNDO_HISTORY_LIMIT:
        del game.history[: len(game.history) - UNDO_HISTORY_LIMIT]


def undo_last_action(game: ActiveGame) -> str:
    """Revert the most recent reversible action.

    Returns a short English description of what was undone.  Raises
    :class:`InvalidMove` when the history is empty.
    """
    if not game.history:
        raise InvalidMove("There is nothing to undo.")
    entry = game.history.pop()
    kind = entry["kind"]
    if kind == "place":
        char_id = entry["char"]
        prev = entry.get("prev_cell")
        if prev is not None:
            game.placements[char_id] = (prev[0], prev[1])
            description = f"Moved {char_id} back to {format_coordinate((prev[0], prev[1]))}."
        else:
            game.placements.pop(char_id, None)
            description = f"Removed the placement of {char_id}."
        removed_x = entry.get("removed_x")
        if removed_x is not None:
            game.global_exclusions.add((removed_x[0], removed_x[1]))
        return description
    if kind == "remove":
        cell = (entry["cell"][0], entry["cell"][1])
        game.placements[entry["char"]] = cell
        return f"Restored {entry['char']} to {format_coordinate(cell)}."
    if kind == "mark_x":
        cell = (entry["cell"][0], entry["cell"][1])
        game.global_exclusions.discard(cell)
        return f"Removed the X mark at {format_coordinate(cell)}."
    if kind == "clear_x":
        cell = (entry["cell"][0], entry["cell"][1])
        game.global_exclusions.add(cell)
        return f"Restored the X mark at {format_coordinate(cell)}."
    if kind == "note_add":
        cell = (entry["cell"][0], entry["cell"][1])
        game.character_exclusions.get(entry["char"], set()).discard(cell)
        return f"Removed the note for {entry['char']} at {format_coordinate(cell)}."
    if kind == "note_remove":
        cell = (entry["cell"][0], entry["cell"][1])
        game.character_exclusions.setdefault(entry["char"], set()).add(cell)
        return f"Restored the note for {entry['char']} at {format_coordinate(cell)}."
    raise InvalidMove("The last action cannot be undone.")


# ---------------------------------------------------------------------------
# Placements
# ---------------------------------------------------------------------------


def place_character(
    game: ActiveGame,
    case: Case,
    geometry: CaseGeometry,
    char_id: str,
    cell: Cell,
) -> str:
    """Place (or move) a character onto a cell.

    Enforces the movement rules only - blocked cells, occupied cells, and
    row/column conflicts.  It deliberately says nothing about whether the
    placement matches the hidden solution.
    """
    character = case.characters_by_id.get(char_id)
    if character is None:
        raise InvalidMove("That character is not part of this case.")
    if cell not in geometry.walkable:
        raise InvalidMove(
            f"{format_coordinate(cell)} is blocked - a character cannot stand there."
        )
    for other_id, other_cell in game.placements.items():
        if other_id == char_id:
            continue
        other = case.characters_by_id.get(other_id)
        if other is None:
            # A stale placement left by a re-imported case that renamed or
            # dropped this character; it must not block every future move.
            continue
        other_name = other.short_name
        if other_cell == cell:
            raise InvalidMove(
                f"{format_coordinate(cell)} is already occupied by {other_name}."
            )
        if other_cell[0] == cell[0]:
            raise InvalidMove(
                f"Row {cell[0] + 1} already contains {other_name} - every row "
                f"holds exactly one character."
            )
        if other_cell[1] == cell[1]:
            raise InvalidMove(
                f"Column {format_coordinate(cell)[0]} already contains {other_name} - "
                f"every column holds exactly one character."
            )

    prev = game.placements.get(char_id)
    removed_x = None
    if cell in game.global_exclusions:
        # Placing a character overrides the player's own X note there.
        game.global_exclusions.discard(cell)
        removed_x = list(cell)
    game.placements[char_id] = cell
    _push_history(
        game,
        {
            "kind": "place",
            "char": char_id,
            "cell": list(cell),
            "prev_cell": list(prev) if prev is not None else None,
            "removed_x": removed_x,
        },
    )
    if prev is not None:
        return (
            f"Moved {character.short_name} from {format_coordinate(prev)} "
            f"to {format_coordinate(cell)}."
        )
    return f"Placed {character.short_name} at {format_coordinate(cell)}."


def remove_character(game: ActiveGame, case: Case, char_id: str) -> str:
    """Remove a character's placement."""
    character = case.characters_by_id.get(char_id)
    if character is None:
        raise InvalidMove("That character is not part of this case.")
    cell = game.placements.pop(char_id, None)
    if cell is None:
        raise InvalidMove(f"{character.short_name} is not placed on the board.")
    _push_history(game, {"kind": "remove", "char": char_id, "cell": list(cell)})
    return f"Removed {character.short_name} from {format_coordinate(cell)}."


# ---------------------------------------------------------------------------
# Marks and notes
# ---------------------------------------------------------------------------


def mark_global_x(game: ActiveGame, geometry: CaseGeometry, cell: Cell) -> str:
    """Add a global X mark - the player's note that no one stands here."""
    occupied_by = [cid for cid, placed in game.placements.items() if placed == cell]
    if occupied_by:
        raise InvalidMove(
            f"{format_coordinate(cell)} is occupied - remove the placement before "
            f"marking the cell."
        )
    if cell not in geometry.walkable:
        raise InvalidMove(
            f"{format_coordinate(cell)} is blocked; it never needs an X mark."
        )
    if cell in game.global_exclusions:
        raise InvalidMove(f"{format_coordinate(cell)} already has an X mark.")
    game.global_exclusions.add(cell)
    _push_history(game, {"kind": "mark_x", "cell": list(cell)})
    return f"Marked {format_coordinate(cell)} with an X."


def toggle_character_note(game: ActiveGame, case: Case, char_id: str, cell: Cell) -> str:
    """Toggle a per-character exclusion note on a cell."""
    character = case.characters_by_id.get(char_id)
    if character is None:
        raise InvalidMove("That character is not part of this case.")
    notes = game.character_exclusions.setdefault(char_id, set())
    if cell in notes:
        notes.discard(cell)
        _push_history(game, {"kind": "note_remove", "char": char_id, "cell": list(cell)})
        return (
            f"Removed the note: {character.short_name} excluded from "
            f"{format_coordinate(cell)}."
        )
    notes.add(cell)
    _push_history(game, {"kind": "note_add", "char": char_id, "cell": list(cell)})
    return f"Noted that {character.short_name} cannot be at {format_coordinate(cell)}."


def clear_mark(game: ActiveGame, cell: Cell) -> str:
    """Clear a mark at a cell.

    Removal order: the selected character's note first, then a global X mark.
    Raises :class:`InvalidMove` when the cell has no mark to clear.
    """
    selected = game.selected_character_id
    if selected is not None:
        notes = game.character_exclusions.get(selected)
        if notes and cell in notes:
            notes.discard(cell)
            _push_history(
                game, {"kind": "note_remove", "char": selected, "cell": list(cell)}
            )
            return (
                f"Cleared the selected character's note at {format_coordinate(cell)}."
            )
    if cell in game.global_exclusions:
        game.global_exclusions.discard(cell)
        _push_history(game, {"kind": "clear_x", "cell": list(cell)})
        return f"Cleared the X mark at {format_coordinate(cell)}."
    raise InvalidMove(f"There is no mark to clear at {format_coordinate(cell)}.")


# ---------------------------------------------------------------------------
# Submission
# ---------------------------------------------------------------------------


@dataclass
class SubmissionResult:
    """Outcome of comparing the player's board against the solution."""

    complete: bool
    missing_character_ids: list[str]
    correct_count: int
    total: int
    is_correct: bool
    incorrect_character_ids: list[str]


def check_submission(game: ActiveGame, case: Case) -> SubmissionResult:
    """Compare the current placements with the hidden solution."""
    all_ids = [c.id for c in case.characters]
    missing = [cid for cid in all_ids if cid not in game.placements]
    if missing:
        return SubmissionResult(
            complete=False,
            missing_character_ids=missing,
            correct_count=0,
            total=len(all_ids),
            is_correct=False,
            incorrect_character_ids=[],
        )
    incorrect = [
        cid for cid in all_ids if game.placements[cid] != case.solution.get(cid)
    ]
    correct = len(all_ids) - len(incorrect)
    return SubmissionResult(
        complete=True,
        missing_character_ids=[],
        correct_count=correct,
        total=len(all_ids),
        is_correct=not incorrect,
        incorrect_character_ids=incorrect,
    )


def derive_murderer(case: Case, geometry: CaseGeometry) -> str | None:
    """Compute the murderer from the stored solution via the victim's room."""
    victim_cell = case.solution.get(case.victim_id)
    if victim_cell is None:
        return None
    victim_room = geometry.room_of.get(victim_cell)
    suspects = [
        cid
        for cid, cell in case.solution.items()
        if cid != case.victim_id and geometry.room_of.get(cell) == victim_room
    ]
    return suspects[0] if len(suspects) == 1 else None


# ---------------------------------------------------------------------------
# Hints
# ---------------------------------------------------------------------------


@dataclass
class HintResult:
    """One hint computed from the solver and the player's placements."""

    level: HintLevel | None
    kind: str  # "elimination", "forced", "reveal", "contradiction", "solved"
    message: str
    character_id: str | None = None
    cell: Cell | None = None


def compute_hint(
    game: ActiveGame,
    case: Case,
    geometry: CaseGeometry,
    *,
    show_contradiction_details: bool = False,
) -> HintResult:
    """Generate the best available hint for the current board.

    Player X marks and notes are deliberately ignored - only confirmed
    placements constrain the reasoning.  The starting hint level escalates
    with the number of hints already used, and each level falls through to
    the next when it has nothing to offer.
    """
    placements = dict(game.placements)
    result = solve(
        case,
        geometry=geometry,
        fixed=placements,
        max_solutions=HINT_SOLUTION_LIMIT,
    )

    if result.status is SolverStatus.NO_SOLUTION:
        return _contradiction_hint(
            game, case, geometry, show_details=show_contradiction_details
        )

    if result.status is SolverStatus.TIMEOUT or not result.all_solutions:
        # Could not reason about the remaining space in time; fall back to
        # revealing a stored-solution coordinate.
        return _reveal_hint(game, case)

    solutions = result.all_solutions
    # Enumeration is exhaustive when the solver stopped before its cap.
    exhaustive = result.solutions_found < HINT_SOLUTION_LIMIT
    unplaced = [c.id for c in case.characters if c.id not in placements]
    if not unplaced:
        return HintResult(
            level=None,
            kind="solved",
            message=(
                "Every character is placed and no clue is violated - "
                "submit your solution!"
            ),
        )

    start_level = min(game.hints_used + 1, HintLevel.REVEAL.value)
    if start_level <= HintLevel.ELIMINATION.value:
        hint = _elimination_hint(case, geometry, placements, solutions, exhaustive)
        if hint is not None:
            return hint
    if start_level <= HintLevel.FORCED.value:
        hint = _forced_hint(case, unplaced, solutions, exhaustive)
        if hint is not None:
            return hint
    return _reveal_hint(game, case)


def _contradiction_hint(
    game: ActiveGame,
    case: Case,
    geometry: CaseGeometry,
    *,
    show_details: bool,
) -> HintResult:
    message = (
        "Your current placements create a contradiction. At least one placed "
        "character must be moved before another logical hint can be provided."
    )
    culprit = None
    if show_details:
        for char_id in game.placements:
            reduced = {k: v for k, v in game.placements.items() if k != char_id}
            retry = solve(case, geometry=geometry, fixed=reduced, max_solutions=1)
            if retry.status is not SolverStatus.NO_SOLUTION:
                culprit = char_id
                break
        if culprit is not None:
            name = case.characters_by_id[culprit].short_name
            message += f" Moving {name} would resolve the contradiction."
    return HintResult(
        level=None, kind="contradiction", message=message, character_id=culprit
    )


def _elimination_hint(
    case: Case,
    geometry: CaseGeometry,
    placements: dict[str, Cell],
    solutions: list[dict[str, Cell]],
    exhaustive: bool,
) -> HintResult | None:
    """Find a (character, cell) pair possible on the board but in no solution."""
    used_rows = {cell[0] for cell in placements.values()}
    used_cols = {cell[1] for cell in placements.values()}
    occupied = set(placements.values())
    verification_budget = 6

    for character in case.characters:
        if character.id in placements:
            continue
        seen_cells = {solution[character.id] for solution in solutions}
        for cell in sorted(geometry.walkable):
            if cell in occupied or cell[0] in used_rows or cell[1] in used_cols:
                continue
            if cell in seen_cells:
                continue
            if not exhaustive:
                # The enumeration was capped, so absence is not proof;
                # verify with a targeted solve before claiming anything.
                if verification_budget <= 0:
                    return None
                verification_budget -= 1
                check = solve(
                    case,
                    geometry=geometry,
                    fixed={**placements, character.id: cell},
                    max_solutions=1,
                )
                if check.status is not SolverStatus.NO_SOLUTION:
                    continue
            return HintResult(
                level=HintLevel.ELIMINATION,
                kind="elimination",
                message=(
                    f"Hint: {character.short_name} cannot be in "
                    f"{format_coordinate(cell)}."
                ),
                character_id=character.id,
                cell=cell,
            )
    return None


def _forced_hint(
    case: Case,
    unplaced: Sequence[str],
    solutions: list[dict[str, Cell]],
    exhaustive: bool,
) -> HintResult | None:
    """Find an unplaced character with the same cell in every solution."""
    if not exhaustive:
        return None
    for char_id in unplaced:
        cells = {solution[char_id] for solution in solutions}
        if len(cells) == 1:
            cell = next(iter(cells))
            name = case.characters_by_id[char_id].short_name
            return HintResult(
                level=HintLevel.FORCED,
                kind="forced",
                message=f"Hint: {name} must be in {format_coordinate(cell)}.",
                character_id=char_id,
                cell=cell,
            )
    return None


def _reveal_hint(game: ActiveGame, case: Case) -> HintResult:
    """Reveal one character's true coordinate from the stored solution."""
    unplaced = [c.id for c in case.characters if c.id not in game.placements]
    misplaced = [
        c.id
        for c in case.characters
        if c.id in game.placements and game.placements[c.id] != case.solution.get(c.id)
    ]
    target = (unplaced or misplaced or [case.characters[0].id])[0]
    cell = case.solution[target]
    name = case.characters_by_id[target].short_name
    return HintResult(
        level=HintLevel.REVEAL,
        kind="reveal",
        message=f"Strong Hint: Place {name} in {format_coordinate(cell)}.",
        character_id=target,
        cell=cell,
    )


# ---------------------------------------------------------------------------
# Daily case selection
# ---------------------------------------------------------------------------


def pick_daily_case(case_ids: Sequence[str], date_key: str) -> str | None:
    """Deterministically pick one case for a ``YYYY-MM-DD`` date key.

    Every guild with the same case pool gets the same case for the same day.
    """
    pool = sorted(case_ids)
    if not pool:
        return None
    digest = hashlib.sha256(f"enigmic-daily:{date_key}".encode("utf-8")).digest()
    return pool[int.from_bytes(digest[:8], "big") % len(pool)]
