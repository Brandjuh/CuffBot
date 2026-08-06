"""Case validation producing a structured, human-readable report.

Validation happens in two stages:

1. *Structural* parsing via :meth:`Case.from_dict` — wrong types, unknown
   clue types, malformed coordinates, and similar problems raise
   :class:`CaseValidationError`, which :func:`validate_case_dict` converts
   into a single ``ERROR`` issue.
2. *Semantic* checks via :func:`validate_case` on a parsed case — identifier
   uniqueness, room coverage, reference integrity, the stored solution, the
   murderer rule, and (optionally) an independent solver run proving the
   puzzle has exactly one solution.

This module is pure stdlib and must never import discord or redbot.
"""

from __future__ import annotations

import re
from collections import Counter, deque
from dataclasses import dataclass, field
from typing import Any, Mapping

from .constants import IMPORT_NODE_LIMIT, IMPORT_TIME_LIMIT, ClueType, Role
from .constraints import CaseGeometry, Tri, evaluate
from .coordinates import format_coordinate, is_orthogonally_adjacent, iter_cells
from .errors import CaseValidationError
from .models import Case, Clue
from .solver import SolverResult, SolverStatus, solve

_SNAKE_CASE_RE = re.compile(r"^[a-z][a-z0-9_]*$")

#: Feature names additionally forbid empty underscore-separated parts
#: ("salt__stain", "stain_"): the renderer builds legend initials from those
#: parts, so a degenerate name would break every board render.
_FEATURE_NAME_RE = re.compile(r"^[a-z0-9]+(?:_[a-z0-9]+)*$")

#: Maximum identifier length.  Character IDs become Discord select-option
#: values (hard limit 100), so identifiers are capped comfortably below.
MAX_ID_LENGTH: int = 64

#: Maximum display-text length for one clue, keeping embeds well within
#: Discord's field limits even for imported custom cases.
MAX_CLUE_TEXT_LENGTH: int = 500

#: Caps on the remaining free-text fields.  Without these an imported case
#: can pass validation and then break message sends or board rendering.
MAX_TITLE_LENGTH: int = 200
MAX_STORY_LENGTH: int = 4000
MAX_NAME_LENGTH: int = 100
MAX_SHORT_NAME_LENGTH: int = 32
MAX_ROOM_NAME_LENGTH: int = 64

#: Distinct floor-feature names allowed in one case; the board legend grows
#: with this number.
MAX_DISTINCT_FEATURES: int = 32

#: A unique case whose solver run needs more nodes than this earns a warning.
COMPLEXITY_WARNING_NODES: int = 100_000


@dataclass
class ValidationIssue:
    """One finding from case validation."""

    severity: str  # "ERROR", "WARNING", or "INFO"
    code: str
    message: str
    location: str | None = None

    def render(self) -> str:
        location = f" [{self.location}]" if self.location else ""
        return f"{self.severity}: {self.code}{location}: {self.message}"


@dataclass
class ValidationReport:
    """All findings for one case, plus the solver result when it ran."""

    case_id: str
    issues: list[ValidationIssue] = field(default_factory=list)
    solver_result: SolverResult | None = None

    @property
    def ok(self) -> bool:
        return not any(issue.severity == "ERROR" for issue in self.issues)

    @property
    def errors(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "ERROR"]

    @property
    def warnings(self) -> list[ValidationIssue]:
        return [i for i in self.issues if i.severity == "WARNING"]

    def add(self, severity: str, code: str, message: str, location: str | None = None) -> None:
        self.issues.append(ValidationIssue(severity, code, message, location))

    def render(self) -> str:
        lines = [f"Validation report for case '{self.case_id}':"]
        if not self.issues:
            lines.append("No issues found.")
        for issue in self.issues:
            lines.append(issue.render())
        if self.solver_result is not None:
            result = self.solver_result
            lines.append(
                f"Solver: {result.status.value}, {result.solutions_found} solution(s), "
                f"{result.nodes_visited} nodes, {result.elapsed_seconds:.3f}s."
            )
        lines.append("Result: " + ("PASSED" if self.ok else "FAILED"))
        return "\n".join(lines)


def validate_case_dict(
    data: Mapping[str, Any],
    *,
    run_solver: bool = True,
    node_limit: int = IMPORT_NODE_LIMIT,
    time_limit: float = IMPORT_TIME_LIMIT,
) -> tuple[Case | None, ValidationReport]:
    """Parse and validate a raw case dictionary.

    Returns the parsed case (or ``None`` when parsing failed) together with
    the validation report.
    """
    case_id = str(data.get("id", "?")) if isinstance(data, Mapping) else "?"
    try:
        case = Case.from_dict(data)
    except CaseValidationError as exc:
        report = ValidationReport(case_id=case_id)
        report.add("ERROR", "parse_error", str(exc))
        return None, report
    report = validate_case(
        case, run_solver=run_solver, node_limit=node_limit, time_limit=time_limit
    )
    return case, report


def validate_case(
    case: Case,
    *,
    run_solver: bool = True,
    node_limit: int = IMPORT_NODE_LIMIT,
    time_limit: float = IMPORT_TIME_LIMIT,
) -> ValidationReport:
    """Run every semantic check on a parsed case."""
    report = ValidationReport(case_id=case.id)
    _check_identifiers(case, report)
    _check_text_fields(case, report)
    _check_characters(case, report)
    _check_rooms(case, report)
    _check_objects_and_features(case, report)
    _check_clue_references(case, report)
    _check_solution(case, report)
    if run_solver and report.ok:
        _check_uniqueness(case, report, node_limit=node_limit, time_limit=time_limit)
    elif run_solver:
        report.add(
            "INFO",
            "solver_skipped",
            "Uniqueness check skipped because earlier errors were found.",
        )
    return report


# ---------------------------------------------------------------------------
# Individual checks
# ---------------------------------------------------------------------------


def _check_snake_case(report: ValidationReport, identifier: str, location: str) -> None:
    if not _SNAKE_CASE_RE.match(identifier):
        report.add(
            "ERROR",
            "invalid_id_format",
            f"Identifier '{identifier}' must be lowercase snake_case.",
            location,
        )
    if len(identifier) > MAX_ID_LENGTH:
        report.add(
            "ERROR",
            "id_too_long",
            f"Identifier '{identifier[:40]}...' exceeds {MAX_ID_LENGTH} characters.",
            location,
        )


def _check_identifiers(case: Case, report: ValidationReport) -> None:
    _check_snake_case(report, case.id, "case")
    for room in case.rooms:
        _check_snake_case(report, room.id, f"room '{room.id}'")
    for character in case.characters:
        _check_snake_case(report, character.id, f"character '{character.id}'")
    for obj in case.objects:
        _check_snake_case(report, obj.id, f"object '{obj.id}'")


def _check_text_fields(case: Case, report: ValidationReport) -> None:
    """Bound every free-text field a case can carry.

    Discord enforces hard limits on embed titles, field values, and message
    content, and the board legend grows with the number of floor features.
    Unbounded text passes every other check and then fails at send or render
    time, so it is rejected at import instead.
    """
    def too_long(value: str, limit: int, code: str, what: str, location: str) -> None:
        if len(value) > limit:
            report.add(
                "ERROR",
                code,
                f"{what} is {len(value)} characters; the maximum is {limit}.",
                location,
            )

    too_long(case.title, MAX_TITLE_LENGTH, "title_too_long", "The case title", "title")
    too_long(case.story, MAX_STORY_LENGTH, "story_too_long", "The case story", "story")

    for character in case.characters:
        location = f"character '{character.id}'"
        too_long(character.name, MAX_NAME_LENGTH, "name_too_long", "The name", location)
        too_long(character.short_name, MAX_SHORT_NAME_LENGTH,
                 "short_name_too_long", "The short name", location)

    for room in case.rooms:
        too_long(room.name, MAX_ROOM_NAME_LENGTH, "room_name_too_long",
                 "The room name", f"room '{room.id}'")

    for game_object in case.objects:
        too_long(game_object.name, MAX_NAME_LENGTH, "object_name_too_long",
                 "The object name", f"object '{game_object.id}'")

    features = {name for names in case.cell_features.values() for name in names}
    for feature in sorted(features):
        if not _FEATURE_NAME_RE.match(feature):
            report.add(
                "ERROR",
                "invalid_feature_name",
                f"Floor feature '{feature[:40]}' must be lowercase snake_case.",
                "cell_features",
            )
    if len(features) > MAX_DISTINCT_FEATURES:
        report.add(
            "ERROR",
            "too_many_features",
            f"The case defines {len(features)} distinct floor features; the "
            f"maximum is {MAX_DISTINCT_FEATURES}.",
            "cell_features",
        )


def _check_characters(case: Case, report: ValidationReport) -> None:
    characters = case.characters
    if len(characters) != case.size:
        report.add(
            "ERROR",
            "character_count",
            f"A {case.size}x{case.size} case needs exactly {case.size} characters "
            f"(including the victim); found {len(characters)}.",
            "characters",
        )

    for label, values in (
        ("id", [c.id for c in characters]),
        ("name", [c.name for c in characters]),
        ("symbol", [c.symbol for c in characters]),
    ):
        for value, count in Counter(values).items():
            if count > 1:
                report.add(
                    "ERROR",
                    f"duplicate_character_{label}",
                    f"Character {label} '{value}' is used {count} times.",
                    "characters",
                )

    for character in characters:
        if len(character.symbol) not in (1, 2):
            report.add(
                "WARNING",
                "symbol_length",
                f"Symbol '{character.symbol}' should be one or two characters.",
                f"character '{character.id}'",
            )

    victims = [c for c in characters if c.role is Role.VICTIM]
    if len(victims) != 1:
        report.add(
            "ERROR",
            "victim_count",
            f"A case must have exactly one victim; found {len(victims)}.",
            "characters",
        )
    elif victims[0].id != case.victim_id:
        report.add(
            "ERROR",
            "victim_id_mismatch",
            f"victim_id is '{case.victim_id}' but the character with the victim "
            f"role is '{victims[0].id}'.",
            "victim_id",
        )
    if case.victim_id not in {c.id for c in characters}:
        report.add(
            "ERROR",
            "unknown_victim",
            f"victim_id '{case.victim_id}' does not match any character.",
            "victim_id",
        )

    killer = case.characters_by_id.get(case.killer_id)
    if killer is None:
        report.add(
            "ERROR",
            "unknown_killer",
            f"killer_id '{case.killer_id}' does not match any character.",
            "killer_id",
        )
    elif killer.role is not Role.SUSPECT:
        report.add(
            "ERROR",
            "killer_not_suspect",
            f"killer_id '{case.killer_id}' must reference a suspect.",
            "killer_id",
        )


def _check_rooms(case: Case, report: ValidationReport) -> None:
    seen: dict[tuple[int, int], str] = {}
    ids = Counter(room.id for room in case.rooms)
    names = Counter(room.name for room in case.rooms)
    for value, count in ids.items():
        if count > 1:
            report.add("ERROR", "duplicate_room_id",
                       f"Room id '{value}' is used {count} times.", "rooms")
    for value, count in names.items():
        if count > 1:
            report.add("ERROR", "duplicate_room_name",
                       f"Room name '{value}' is used {count} times.", "rooms")

    for room in case.rooms:
        for cell in room.cells:
            if cell in seen and seen[cell] != room.id:
                report.add(
                    "ERROR",
                    "overlapping_rooms",
                    f"Cell {format_coordinate(cell)} belongs to both "
                    f"'{seen[cell]}' and '{room.id}'.",
                    f"room '{room.id}'",
                )
            seen[cell] = room.id
        if room.render_label_cell not in room.cells:
            report.add(
                "ERROR",
                "label_outside_room",
                f"render_label_cell {format_coordinate(room.render_label_cell)} "
                f"is not one of the room's cells.",
                f"room '{room.id}'",
            )
        if not _is_contiguous(room.cells):
            report.add(
                "WARNING",
                "disconnected_room",
                f"Room '{room.id}' is not a contiguous area.",
                f"room '{room.id}'",
            )

    missing = [c for c in iter_cells(case.size) if c not in seen]
    if missing:
        cells = ", ".join(format_coordinate(c) for c in sorted(missing)[:10])
        report.add(
            "ERROR",
            "missing_room_cells",
            f"{len(missing)} cell(s) belong to no room: {cells}.",
            "rooms",
        )


def _is_contiguous(cells: frozenset) -> bool:
    if not cells:
        return True
    start = next(iter(cells))
    reached = {start}
    queue = deque([start])
    while queue:
        current = queue.popleft()
        for other in cells:
            if other not in reached and is_orthogonally_adjacent(current, other):
                reached.add(other)
                queue.append(other)
    return len(reached) == len(cells)


def _check_objects_and_features(case: Case, report: ValidationReport) -> None:
    ids = Counter(obj.id for obj in case.objects)
    for value, count in ids.items():
        if count > 1:
            report.add("ERROR", "duplicate_object_id",
                       f"Object id '{value}' is used {count} times.", "objects")
    cells = Counter(obj.cell for obj in case.objects)
    for cell, count in cells.items():
        if count > 1:
            report.add(
                "WARNING",
                "stacked_objects",
                f"{count} objects share cell {format_coordinate(cell)}.",
                "objects",
            )
    for obj in case.objects:
        if not obj.blocks_movement and obj.cell in case.blocked_cells:
            report.add(
                "INFO",
                "object_on_blocked_cell",
                f"Object '{obj.id}' sits on a blocked cell.",
                f"object '{obj.id}'",
            )


def _check_clue_references(case: Case, report: ValidationReport) -> None:
    character_ids = {c.id for c in case.characters}
    room_ids = {r.id for r in case.rooms}
    object_ids = {o.id for o in case.objects}
    known_features = {name for names in case.cell_features.values() for name in names}

    owners_with_clues: set[str] = set()
    for index, clue in enumerate(case.clues, start=1):
        location = f"clue {index}"
        if clue.owner not in character_ids:
            report.add("ERROR", "unknown_clue_owner",
                       f"Clue owner '{clue.owner}' is not a character.", location)
        else:
            owners_with_clues.add(clue.owner)
        for char_id in clue.scope - {clue.owner}:
            if char_id not in character_ids:
                report.add("ERROR", "unknown_character_reference",
                           f"Clue references unknown character '{char_id}'.", location)
        for room_id in clue.referenced_rooms():
            if room_id not in room_ids:
                report.add("ERROR", "unknown_room_reference",
                           f"Clue references unknown room '{room_id}'.", location)
        for object_id in clue.referenced_objects():
            if object_id not in object_ids:
                report.add("ERROR", "unknown_object_reference",
                           f"Clue references unknown object '{object_id}'.", location)
        for feature in _referenced_features(clue):
            if feature not in known_features:
                report.add("ERROR", "unknown_feature_reference",
                           f"Clue references unknown feature '{feature}'.", location)
        for kind in _vacuous_kinds(clue):
            requirement = _UNSATISFIABLE_BETWEEN_CHARACTERS.get(kind)
            if requirement is not None:
                report.add(
                    "ERROR",
                    "unsatisfiable_clue",
                    f"'{kind.value}' can never be true: it requires two "
                    f"characters to {requirement}, but every row and column "
                    f"holds exactly one character. Use the matching "
                    f"'..._object' clue instead.",
                    location,
                )
            else:
                report.add(
                    "WARNING",
                    "vacuous_clue",
                    f"'{kind.value}' is always true, because two characters "
                    f"can never share a row or column and so can never be "
                    f"adjacent. The clue tells the player nothing.",
                    location,
                )
        if _references_self(clue):
            report.add("ERROR", "self_reference",
                       f"Clue about '{clue.owner}' references the same character.",
                       location)
        if not clue.text.strip():
            report.add(
                "WARNING",
                "empty_clue_text",
                f"The clue about '{clue.owner}' has no display text, so players "
                f"cannot read it and the puzzle becomes undeducible.",
                location,
            )
        if len(clue.text) > MAX_CLUE_TEXT_LENGTH:
            report.add(
                "ERROR",
                "clue_text_too_long",
                f"Clue display text is {len(clue.text)} characters; the "
                f"maximum is {MAX_CLUE_TEXT_LENGTH}.",
                location,
            )

    for character in case.characters:
        if character.id not in owners_with_clues:
            report.add(
                "ERROR",
                "missing_character_clue",
                f"Character '{character.id}' has no clue.",
                "clues",
            )


def _referenced_features(clue: Clue) -> set[str]:
    features = set()
    feature = clue.params.get("feature")
    if feature is not None:
        features.add(feature)
    for child in clue.children:
        features |= _referenced_features(child)
    return features


#: Clue types that can never hold between two characters.  Every row and
#: every column contains exactly one character, so no two characters can
#: share a row or a column - and "beside" needs one of those, while each
#: "directly ..." relation needs one outright.  A case using any of these
#: has no solution at all.
_UNSATISFIABLE_BETWEEN_CHARACTERS = {
    ClueType.BESIDE_CHARACTER: "be beside each other",
    ClueType.DIRECTLY_NORTH_OF_CHARACTER: "share a column",
    ClueType.DIRECTLY_SOUTH_OF_CHARACTER: "share a column",
    ClueType.DIRECTLY_EAST_OF_CHARACTER: "share a row",
    ClueType.DIRECTLY_WEST_OF_CHARACTER: "share a row",
}

#: The negation of an impossible relation is a tautology: always true, so it
#: constrains nothing while reading to the player like a real clue.
_TAUTOLOGICAL_BETWEEN_CHARACTERS = frozenset({ClueType.NOT_BESIDE_CHARACTER})


def _vacuous_kinds(clue: Clue) -> list[ClueType]:
    """Return degenerate character-relation kinds used anywhere in a clue."""
    degenerate = set(_UNSATISFIABLE_BETWEEN_CHARACTERS) | _TAUTOLOGICAL_BETWEEN_CHARACTERS
    found = [clue.kind] if clue.kind in degenerate else []
    for child in clue.children:
        found.extend(_vacuous_kinds(child))
    return found


def _references_self(clue: Clue) -> bool:
    if clue.params.get("character_id") == clue.owner:
        return True
    return any(_references_self(child) for child in clue.children)


def _check_solution(case: Case, report: ValidationReport) -> None:
    character_ids = {c.id for c in case.characters}
    solution = case.solution

    for char_id in character_ids - set(solution):
        report.add("ERROR", "solution_missing_character",
                   f"Solution has no position for '{char_id}'.", "solution")
    for char_id in set(solution) - character_ids:
        report.add("ERROR", "solution_unknown_character",
                   f"Solution places unknown character '{char_id}'.", "solution")
    if set(solution) != character_ids:
        return  # positional checks below assume a complete mapping

    cells = list(solution.values())
    for cell, count in Counter(cells).items():
        if count > 1:
            report.add("ERROR", "solution_duplicate_cell",
                       f"Cell {format_coordinate(cell)} is used {count} times.",
                       "solution")

    blocked = case.all_blocked_cells
    for char_id, cell in solution.items():
        if cell in blocked:
            report.add("ERROR", "solution_on_blocked_cell",
                       f"'{char_id}' is placed on blocked cell "
                       f"{format_coordinate(cell)}.", "solution")

    rows = Counter(cell[0] for cell in cells)
    cols = Counter(cell[1] for cell in cells)
    for row, count in rows.items():
        if count > 1:
            report.add("ERROR", "solution_row_conflict",
                       f"Row {row + 1} contains {count} characters.", "solution")
    for col, count in cols.items():
        if count > 1:
            report.add("ERROR", "solution_column_conflict",
                       f"Column {'ABCDEFGH'[col]} contains {count} characters.",
                       "solution")

    geometry = CaseGeometry.from_case(case)
    for index, clue in enumerate(case.clues, start=1):
        if clue.owner not in character_ids:
            continue
        result = evaluate(clue, solution, geometry)
        if result is not Tri.TRUE:
            report.add(
                "ERROR",
                "false_clue",
                f"Clue about '{clue.owner}' is {result.value} in the stored "
                f"solution: {clue.text or clue.kind.value}",
                f"clue {index}",
            )

    _check_murderer(case, geometry, report)


def _check_murderer(case: Case, geometry: CaseGeometry, report: ValidationReport) -> None:
    victim_cell = case.solution.get(case.victim_id)
    if victim_cell is None:
        return
    victim_room = geometry.room_of.get(victim_cell)
    if victim_room is None:
        report.add("ERROR", "victim_outside_rooms",
                   "The victim's cell belongs to no room.", "solution")
        return
    suspects_in_room = [
        char_id
        for char_id, cell in case.solution.items()
        if char_id != case.victim_id and geometry.room_of.get(cell) == victim_room
    ]
    if len(suspects_in_room) != 1:
        report.add(
            "ERROR",
            "invalid_murderer_count",
            f"The victim's room '{victim_room}' contains {len(suspects_in_room)} "
            f"suspect(s); it must contain exactly one.",
            "solution",
        )
        return
    derived = suspects_in_room[0]
    if derived != case.killer_id:
        report.add(
            "ERROR",
            "killer_mismatch",
            f"The suspect alone with the victim is '{derived}', but killer_id "
            f"is '{case.killer_id}'.",
            "killer_id",
        )


def _check_uniqueness(
    case: Case,
    report: ValidationReport,
    *,
    node_limit: int,
    time_limit: float,
) -> None:
    result = solve(case, max_solutions=2, node_limit=node_limit, time_limit=time_limit)
    report.solver_result = result
    if result.status is SolverStatus.TIMEOUT:
        report.add(
            "ERROR",
            "solver_budget_exceeded",
            f"The solver exceeded its budget ({result.nodes_visited} nodes, "
            f"{result.elapsed_seconds:.2f}s) before proving uniqueness. "
            f"The case is too complex to accept.",
        )
        return
    if result.status is SolverStatus.NO_SOLUTION:
        report.add("ERROR", "no_solution",
                   "No arrangement satisfies every rule and clue.")
        return
    if result.status is SolverStatus.MULTIPLE_SOLUTIONS:
        report.add(
            "ERROR",
            "multiple_solutions",
            "More than one arrangement satisfies every rule and clue; the "
            "puzzle must have exactly one solution.",
        )
        return
    if result.all_solutions and result.all_solutions[0] != dict(case.solution):
        report.add(
            "ERROR",
            "stored_solution_mismatch",
            "The unique solver solution differs from the stored solution.",
            "solution",
        )
    if result.nodes_visited > COMPLEXITY_WARNING_NODES:
        report.add(
            "WARNING",
            "high_complexity",
            f"The solver needed {result.nodes_visited} nodes; the case may be "
            f"very hard for players.",
        )
