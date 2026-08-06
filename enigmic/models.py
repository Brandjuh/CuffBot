"""Typed data models for cases and active games.

All models parse from and serialize to plain JSON-compatible dictionaries.
Parsing is *structurally* strict — wrong types, missing required fields, or
malformed coordinates raise :class:`CaseValidationError` — while deeper
semantic checks (uniqueness of the solution, clue truth, the murderer rule,
and so on) live in :mod:`.validator`.

This module is pure stdlib and must never import discord or redbot.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from functools import cached_property
from pathlib import Path
from typing import Any, Iterator, Mapping

from .constants import (
    CASE_SCHEMA_VERSION,
    COMPOUND_CLUE_TYPES,
    GAME_SCHEMA_VERSION,
    MAX_GRID_SIZE,
    MIN_GRID_SIZE,
    ClueType,
    Difficulty,
    GameMode,
    GameStatus,
    Role,
)
from .coordinates import Cell, format_coordinate, normalize_edge, parse_coordinate
from .errors import CaseValidationError, InvalidCoordinate


def _require(data: Mapping[str, Any], key: str, kind: type, location: str) -> Any:
    """Fetch ``data[key]`` and check its type, raising a readable error."""
    if key not in data:
        raise CaseValidationError(f"{location}: missing required field '{key}'.")
    value = data[key]
    if kind is float and isinstance(value, int):
        value = float(value)
    if not isinstance(value, kind):
        raise CaseValidationError(
            f"{location}: field '{key}' must be of type {kind.__name__}, "
            f"got {type(value).__name__}."
        )
    return value


def _parse_cell(text: Any, size: int, location: str) -> Cell:
    """Parse a JSON coordinate string, re-raising with location context."""
    if not isinstance(text, str):
        raise CaseValidationError(f"{location}: coordinate must be a string, got {text!r}.")
    try:
        return parse_coordinate(text, size)
    except InvalidCoordinate as exc:
        raise CaseValidationError(f"{location}: {exc}") from exc


# ---------------------------------------------------------------------------
# Case components
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Character:
    """A suspect or the victim."""

    id: str
    name: str
    short_name: str
    role: Role
    symbol: str
    description: str = ""

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "Character":
        location = f"character '{data.get('id', '?')}'"
        role_raw = _require(data, "role", str, location)
        try:
            role = Role(role_raw)
        except ValueError:
            raise CaseValidationError(
                f"{location}: role must be 'suspect' or 'victim', got '{role_raw}'."
            ) from None
        return cls(
            id=_require(data, "id", str, location),
            name=_require(data, "name", str, location),
            short_name=_require(data, "short_name", str, location),
            role=role,
            symbol=_require(data, "symbol", str, location),
            description=str(data.get("description", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "short_name": self.short_name,
            "role": self.role.value,
            "symbol": self.symbol,
            "description": self.description,
        }


@dataclass(frozen=True)
class Room:
    """A named region of the board."""

    id: str
    name: str
    cells: frozenset[Cell]
    render_label_cell: Cell

    @classmethod
    def from_dict(cls, data: Mapping[str, Any], size: int) -> "Room":
        location = f"room '{data.get('id', '?')}'"
        raw_cells = _require(data, "cells", list, location)
        cells = frozenset(_parse_cell(c, size, location) for c in raw_cells)
        if not cells:
            raise CaseValidationError(f"{location}: has no cells.")
        label_raw = data.get("render_label_cell")
        if label_raw is None:
            label = min(cells)
        else:
            label = _parse_cell(label_raw, size, location)
        return cls(
            id=_require(data, "id", str, location),
            name=_require(data, "name", str, location),
            cells=cells,
            render_label_cell=label,
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "cells": sorted(format_coordinate(c) for c in self.cells),
            "render_label_cell": format_coordinate(self.render_label_cell),
        }


@dataclass(frozen=True)
class GameObject:
    """A physical object on the board that clues may reference."""

    id: str
    name: str
    cell: Cell
    blocks_movement: bool
    symbol: str = ""

    @classmethod
    def from_dict(cls, data: Mapping[str, Any], size: int) -> "GameObject":
        location = f"object '{data.get('id', '?')}'"
        return cls(
            id=_require(data, "id", str, location),
            name=_require(data, "name", str, location),
            cell=_parse_cell(_require(data, "cell", str, location), size, location),
            blocks_movement=bool(_require(data, "blocks_movement", bool, location)),
            symbol=str(data.get("symbol", "")),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "cell": format_coordinate(self.cell),
            "blocks_movement": self.blocks_movement,
            "symbol": self.symbol,
        }


@dataclass(frozen=True)
class Clue:
    """One structured, machine-evaluated constraint.

    ``owner`` is the character the clue is about.  Compound clues carry their
    child constraints in ``children``; the children share the parent's owner
    and have empty display text.
    """

    owner: str
    kind: ClueType
    params: Mapping[str, Any]
    text: str
    children: tuple["Clue", ...] = ()

    #: Parameter keys allowed per clue type (beyond owner/type/text).
    _PARAM_KEYS = {
        ClueType.IN_ROOM: ("room_id",),
        ClueType.NOT_IN_ROOM: ("room_id",),
        ClueType.IN_ROW: ("row",),
        ClueType.NOT_IN_ROW: ("row",),
        ClueType.IN_COLUMN: ("column",),
        ClueType.NOT_IN_COLUMN: ("column",),
        ClueType.ON_FEATURE: ("feature",),
        ClueType.NOT_ON_FEATURE: ("feature",),
        ClueType.BESIDE_CHARACTER: ("character_id",),
        ClueType.NOT_BESIDE_CHARACTER: ("character_id",),
        ClueType.NORTH_OF_CHARACTER: ("character_id",),
        ClueType.SOUTH_OF_CHARACTER: ("character_id",),
        ClueType.EAST_OF_CHARACTER: ("character_id",),
        ClueType.WEST_OF_CHARACTER: ("character_id",),
        ClueType.DIRECTLY_NORTH_OF_CHARACTER: ("character_id",),
        ClueType.DIRECTLY_SOUTH_OF_CHARACTER: ("character_id",),
        ClueType.DIRECTLY_EAST_OF_CHARACTER: ("character_id",),
        ClueType.DIRECTLY_WEST_OF_CHARACTER: ("character_id",),
        ClueType.SAME_ROOM_AS_CHARACTER: ("character_id",),
        ClueType.DIFFERENT_ROOM_FROM_CHARACTER: ("character_id",),
        ClueType.BESIDE_OBJECT: ("object_id",),
        ClueType.NOT_BESIDE_OBJECT: ("object_id",),
        ClueType.NORTH_OF_OBJECT: ("object_id",),
        ClueType.SOUTH_OF_OBJECT: ("object_id",),
        ClueType.EAST_OF_OBJECT: ("object_id",),
        ClueType.WEST_OF_OBJECT: ("object_id",),
        ClueType.IN_SAME_ROOM_AS_OBJECT: ("object_id",),
        ClueType.NOT_IN_SAME_ROOM_AS_OBJECT: ("object_id",),
    }

    @classmethod
    def from_dict(
        cls,
        data: Mapping[str, Any],
        size: int,
        *,
        owner: str | None = None,
        location: str = "clue",
    ) -> "Clue":
        """Parse a clue dictionary.

        Top-level clues must carry an ``owner``; children of compound clues
        inherit the parent's owner instead.
        """
        if owner is None:
            owner = _require(data, "owner", str, location)
        kind_raw = _require(data, "type", str, location)
        try:
            kind = ClueType(kind_raw)
        except ValueError:
            raise CaseValidationError(
                f"{location}: unknown clue type '{kind_raw}'."
            ) from None
        location = f"{location} ({owner}/{kind.value})"

        if kind in COMPOUND_CLUE_TYPES:
            raw_children = _require(data, "constraints", list, location)
            if not raw_children:
                raise CaseValidationError(f"{location}: compound clue has no constraints.")
            children = tuple(
                cls.from_dict(child, size, owner=owner, location=f"{location} child {i + 1}")
                for i, child in enumerate(raw_children)
            )
            return cls(owner=owner, kind=kind, params={}, text=str(data.get("text", "")),
                       children=children)

        params: dict[str, Any] = {}
        for key in cls._PARAM_KEYS[kind]:
            value = data.get(key)
            if value is None:
                raise CaseValidationError(f"{location}: missing required field '{key}'.")
            if key == "row":
                if not isinstance(value, int) or not (1 <= value <= size):
                    raise CaseValidationError(
                        f"{location}: row must be an integer between 1 and {size}."
                    )
                params[key] = value - 1  # store 0-based internally
            elif key == "column":
                # Accept a column letter such as "B".
                cell = _parse_cell(f"{value}1", size, location) if isinstance(value, str) else None
                if cell is None:
                    raise CaseValidationError(
                        f"{location}: column must be a letter such as 'B'."
                    )
                params[key] = cell[1]  # store 0-based internally
            else:
                if not isinstance(value, str):
                    raise CaseValidationError(f"{location}: field '{key}' must be a string.")
                params[key] = value
        return cls(owner=owner, kind=kind, params=params, text=str(data.get("text", "")))

    def to_dict(self, *, top_level: bool = True) -> dict[str, Any]:
        data: dict[str, Any] = {}
        if top_level:
            data["owner"] = self.owner
        data["type"] = self.kind.value
        if self.kind in COMPOUND_CLUE_TYPES:
            data["constraints"] = [c.to_dict(top_level=False) for c in self.children]
        else:
            for key, value in self.params.items():
                if key == "row":
                    data[key] = value + 1
                elif key == "column":
                    data[key] = "ABCDEFGH"[value]
                else:
                    data[key] = value
        if top_level or self.text:
            data["text"] = self.text
        return data

    @property
    def scope(self) -> frozenset[str]:
        """IDs of every character this clue references (owner included)."""
        ids = {self.owner}
        target = self.params.get("character_id")
        if target is not None:
            ids.add(target)
        for child in self.children:
            ids |= child.scope
        return frozenset(ids)

    def referenced_rooms(self) -> set[str]:
        rooms = set()
        room = self.params.get("room_id")
        if room is not None:
            rooms.add(room)
        for child in self.children:
            rooms |= child.referenced_rooms()
        return rooms

    def referenced_objects(self) -> set[str]:
        objects = set()
        obj = self.params.get("object_id")
        if obj is not None:
            objects.add(obj)
        for child in self.children:
            objects |= child.referenced_objects()
        return objects


# ---------------------------------------------------------------------------
# Case
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Case:
    """A complete murder case definition."""

    schema_version: int
    id: str
    title: str
    difficulty: Difficulty
    story: str
    size: int
    rooms: tuple[Room, ...]
    blocked_cells: frozenset[Cell]
    cell_features: Mapping[Cell, tuple[str, ...]]
    objects: tuple[GameObject, ...]
    walls: frozenset[tuple[Cell, Cell]]
    characters: tuple[Character, ...]
    victim_id: str
    clues: tuple[Clue, ...]
    solution: Mapping[str, Cell]
    killer_id: str
    author: str = ""
    version: int = 1

    # -- derived lookups ----------------------------------------------------

    @cached_property
    def fingerprint(self) -> str:
        """Stable digest of the whole case definition.

        Used as the cache key for derived artefacts (geometry, rendered
        backgrounds).  Keying those on ``id`` alone would be wrong: custom
        cases are per-guild, so two different guilds can define different
        cases under the same ID, and re-importing a case under an unchanged
        version must not keep serving the previous layout.
        """
        payload = json.dumps(self.to_dict(), sort_keys=True, ensure_ascii=False)
        return hashlib.sha1(payload.encode("utf-8")).hexdigest()

    @property
    def characters_by_id(self) -> dict[str, Character]:
        return {c.id: c for c in self.characters}

    @property
    def rooms_by_id(self) -> dict[str, Room]:
        return {r.id: r for r in self.rooms}

    @property
    def objects_by_id(self) -> dict[str, GameObject]:
        return {o.id: o for o in self.objects}

    @property
    def all_blocked_cells(self) -> frozenset[Cell]:
        """Blocked cells including cells of movement-blocking objects."""
        blocked = set(self.blocked_cells)
        blocked.update(o.cell for o in self.objects if o.blocks_movement)
        return frozenset(blocked)

    @property
    def suspects(self) -> tuple[Character, ...]:
        return tuple(c for c in self.characters if c.role is Role.SUSPECT)

    @property
    def victim(self) -> Character | None:
        return self.characters_by_id.get(self.victim_id)

    def features_at(self, cell: Cell) -> tuple[str, ...]:
        return self.cell_features.get(cell, ())

    # -- (de)serialization --------------------------------------------------

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "Case":
        if not isinstance(data, Mapping):
            raise CaseValidationError("Case definition must be a JSON object.")
        case_id = data.get("id", "?")
        location = f"case '{case_id}'"

        schema_version = _require(data, "schema_version", int, location)
        if schema_version != CASE_SCHEMA_VERSION:
            raise CaseValidationError(
                f"{location}: unsupported schema_version {schema_version} "
                f"(expected {CASE_SCHEMA_VERSION})."
            )

        size = _require(data, "size", int, location)
        if not MIN_GRID_SIZE <= size <= MAX_GRID_SIZE:
            raise CaseValidationError(
                f"{location}: size must be between {MIN_GRID_SIZE} and {MAX_GRID_SIZE}."
            )

        difficulty_raw = _require(data, "difficulty", str, location)
        difficulty = Difficulty.from_str(difficulty_raw)
        if difficulty is None:
            raise CaseValidationError(
                f"{location}: unknown difficulty '{difficulty_raw}'."
            )

        rooms = tuple(
            Room.from_dict(r, size) for r in _require(data, "rooms", list, location)
        )
        blocked = frozenset(
            _parse_cell(c, size, f"{location} blocked_cells")
            for c in data.get("blocked_cells", [])
        )

        features_raw = data.get("cell_features", {})
        if not isinstance(features_raw, Mapping):
            raise CaseValidationError(f"{location}: cell_features must be an object.")
        cell_features: dict[Cell, tuple[str, ...]] = {}
        for coord_text, names in features_raw.items():
            cell = _parse_cell(coord_text, size, f"{location} cell_features")
            if not isinstance(names, list) or not all(isinstance(n, str) for n in names):
                raise CaseValidationError(
                    f"{location}: cell_features['{coord_text}'] must be a list of strings."
                )
            cell_features[cell] = tuple(names)

        objects = tuple(
            GameObject.from_dict(o, size) for o in data.get("objects", [])
        )

        walls: set[tuple[Cell, Cell]] = set()
        for i, pair in enumerate(data.get("walls", [])):
            wall_loc = f"{location} wall {i + 1}"
            if not isinstance(pair, list) or len(pair) != 2:
                raise CaseValidationError(
                    f"{wall_loc}: a wall must be a pair of adjacent coordinates."
                )
            a = _parse_cell(pair[0], size, wall_loc)
            b = _parse_cell(pair[1], size, wall_loc)
            if abs(a[0] - b[0]) + abs(a[1] - b[1]) != 1:
                raise CaseValidationError(
                    f"{wall_loc}: cells {pair[0]} and {pair[1]} are not orthogonally adjacent."
                )
            walls.add(normalize_edge(a, b))

        characters = tuple(
            Character.from_dict(c) for c in _require(data, "characters", list, location)
        )

        clues = tuple(
            Clue.from_dict(c, size, location=f"{location} clue {i + 1}")
            for i, c in enumerate(_require(data, "clues", list, location))
        )

        solution_raw = _require(data, "solution", dict, location)
        solution = {
            str(char_id): _parse_cell(coord, size, f"{location} solution['{char_id}']")
            for char_id, coord in solution_raw.items()
        }

        return cls(
            schema_version=schema_version,
            id=_require(data, "id", str, location),
            title=_require(data, "title", str, location),
            difficulty=difficulty,
            story=_require(data, "story", str, location),
            size=size,
            rooms=rooms,
            blocked_cells=blocked,
            cell_features=cell_features,
            objects=objects,
            walls=frozenset(walls),
            characters=characters,
            victim_id=_require(data, "victim_id", str, location),
            clues=clues,
            solution=solution,
            killer_id=_require(data, "killer_id", str, location),
            author=str(data.get("author", "")),
            version=int(data.get("version", 1)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "id": self.id,
            "title": self.title,
            "difficulty": self.difficulty.value,
            "story": self.story,
            "size": self.size,
            "rooms": [r.to_dict() for r in self.rooms],
            "blocked_cells": sorted(format_coordinate(c) for c in self.blocked_cells),
            "cell_features": {
                format_coordinate(cell): list(names)
                for cell, names in sorted(self.cell_features.items())
            },
            "objects": [o.to_dict() for o in self.objects],
            "walls": [
                [format_coordinate(a), format_coordinate(b)]
                for a, b in sorted(self.walls)
            ],
            "characters": [c.to_dict() for c in self.characters],
            "victim_id": self.victim_id,
            "clues": [c.to_dict() for c in self.clues],
            "solution": {
                char_id: format_coordinate(cell)
                for char_id, cell in sorted(self.solution.items())
            },
            "killer_id": self.killer_id,
            "author": self.author,
            "version": self.version,
        }


def load_case_file(path: Path) -> Case:
    """Load and parse one case JSON file."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CaseValidationError(f"Could not read case file '{path.name}': {exc}") from exc
    return Case.from_dict(raw)


def iter_case_files(directory: Path) -> Iterator[Path]:
    """Yield every ``*.json`` case file in ``directory`` in sorted order."""
    if not directory.is_dir():
        return
    yield from sorted(directory.glob("*.json"))


# ---------------------------------------------------------------------------
# Active game state
# ---------------------------------------------------------------------------


@dataclass
class ActiveGame:
    """Serializable state of one player's game in progress."""

    guild_id: int
    channel_id: int
    player_id: int
    case_id: str
    game_id: str
    schema_version: int = GAME_SCHEMA_VERSION
    message_id: int | None = None
    mode: GameMode = GameMode.STANDARD
    status: GameStatus = GameStatus.ACTIVE
    daily_date: str | None = None
    placements: dict[str, Cell] = field(default_factory=dict)
    global_exclusions: set[Cell] = field(default_factory=set)
    character_exclusions: dict[str, set[Cell]] = field(default_factory=dict)
    selected_character_id: str | None = None
    history: list[dict[str, Any]] = field(default_factory=list)
    started_at: str = ""
    last_action_at: str = ""
    hints_used: int = 0
    hint_history: list[dict[str, Any]] = field(default_factory=list)
    wrong_submissions: int = 0
    last_submission_at: str | None = None
    board_sequence: int = 0

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> "ActiveGame":
        def cells(items: Any) -> set[Cell]:
            return {(int(r), int(c)) for r, c in (items or [])}

        return cls(
            schema_version=int(data.get("schema_version", GAME_SCHEMA_VERSION)),
            guild_id=int(data["guild_id"]),
            channel_id=int(data["channel_id"]),
            message_id=int(data["message_id"]) if data.get("message_id") else None,
            player_id=int(data["player_id"]),
            case_id=str(data["case_id"]),
            game_id=str(data["game_id"]),
            mode=GameMode(data.get("mode", GameMode.STANDARD.value)),
            status=GameStatus(data.get("status", GameStatus.ACTIVE.value)),
            daily_date=data.get("daily_date"),
            placements={
                str(k): (int(v[0]), int(v[1]))
                for k, v in (data.get("placements") or {}).items()
            },
            global_exclusions=cells(data.get("global_exclusions")),
            character_exclusions={
                str(k): cells(v)
                for k, v in (data.get("character_exclusions") or {}).items()
            },
            selected_character_id=data.get("selected_character_id"),
            history=list(data.get("history") or []),
            started_at=str(data.get("started_at", "")),
            last_action_at=str(data.get("last_action_at", "")),
            hints_used=int(data.get("hints_used", 0)),
            hint_history=list(data.get("hint_history") or []),
            wrong_submissions=int(data.get("wrong_submissions", 0)),
            last_submission_at=data.get("last_submission_at"),
            board_sequence=int(data.get("board_sequence", 0)),
        )

    def to_dict(self) -> dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "guild_id": self.guild_id,
            "channel_id": self.channel_id,
            "message_id": self.message_id,
            "player_id": self.player_id,
            "case_id": self.case_id,
            "game_id": self.game_id,
            "mode": self.mode.value,
            "status": self.status.value,
            "daily_date": self.daily_date,
            "placements": {k: list(v) for k, v in self.placements.items()},
            "global_exclusions": [list(c) for c in sorted(self.global_exclusions)],
            "character_exclusions": {
                k: [list(c) for c in sorted(v)]
                for k, v in self.character_exclusions.items()
            },
            "selected_character_id": self.selected_character_id,
            "history": self.history,
            "started_at": self.started_at,
            "last_action_at": self.last_action_at,
            "hints_used": self.hints_used,
            "hint_history": self.hint_history,
            "wrong_submissions": self.wrong_submissions,
            "last_submission_at": self.last_submission_at,
            "board_sequence": self.board_sequence,
        }
