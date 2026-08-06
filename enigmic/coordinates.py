"""Coordinate parsing, formatting, and direction math.

Convention
----------
A coordinate string such as ``"B4"`` combines a column letter and a row
number.  Column ``A`` is the westernmost column and row ``1`` is the
northernmost row, so ``"A1"`` is the top-left cell of the board.

Internally coordinates are ``(row, col)`` tuples with 0-based indices:
``"A1"`` is ``(0, 0)`` and ``"B4"`` is ``(3, 1)``.

Direction semantics (per the game rules):

* *North of*: strictly lower row index.
* *South of*: strictly higher row index.
* *West of*: strictly lower column index.
* *East of*: strictly higher column index.
* *Directly north/south/east/west of*: same column/row plus the general
  direction requirement.
* *Beside*: orthogonally adjacent (diagonals never count).  Walls further
  restrict "beside" but are handled by :class:`~.constraints.CaseGeometry`,
  not here.

This module is pure stdlib and must never import discord or redbot.
"""

from __future__ import annotations

import re
from typing import Iterator

from .constants import COLUMN_LETTERS, MAX_GRID_SIZE, MIN_GRID_SIZE
from .errors import InvalidCoordinate

Cell = tuple[int, int]
"""A 0-based ``(row, col)`` grid position."""

_COORD_RE = re.compile(r"^\s*([A-Za-z])\s*([0-9]{1,2})\s*$")


def parse_coordinate(text: str, size: int) -> Cell:
    """Parse a coordinate string like ``"B4"`` into a ``(row, col)`` tuple.

    Lowercase input is normalized to uppercase.  Raises
    :class:`InvalidCoordinate` with a user-readable message when the text is
    malformed or outside the ``size`` × ``size`` board.
    """
    if not MIN_GRID_SIZE <= size <= MAX_GRID_SIZE:
        raise InvalidCoordinate(
            f"Unsupported board size {size}. Sizes {MIN_GRID_SIZE}-{MAX_GRID_SIZE} are allowed."
        )
    match = _COORD_RE.match(text or "")
    if match is None:
        raise InvalidCoordinate(
            f"'{text}' is not a valid coordinate. Use a column letter followed by "
            f"a row number, for example A1 or {COLUMN_LETTERS[size - 1]}{size}."
        )
    letter = match.group(1).upper()
    col = COLUMN_LETTERS.find(letter)
    if col < 0 or col >= size:
        raise InvalidCoordinate(
            f"Column '{letter}' is outside this board. "
            f"Valid columns are A-{COLUMN_LETTERS[size - 1]}."
        )
    row = int(match.group(2)) - 1
    if row < 0 or row >= size:
        raise InvalidCoordinate(
            f"Row '{match.group(2)}' is outside this board. Valid rows are 1-{size}."
        )
    return (row, col)


def format_coordinate(cell: Cell) -> str:
    """Format a ``(row, col)`` tuple as a coordinate string like ``"B4"``."""
    row, col = cell
    if not (0 <= col < len(COLUMN_LETTERS)) or row < 0 or row >= MAX_GRID_SIZE:
        raise InvalidCoordinate(f"Cell {cell!r} cannot be formatted as a coordinate.")
    return f"{COLUMN_LETTERS[col]}{row + 1}"


def is_valid_cell(cell: Cell, size: int) -> bool:
    """Return ``True`` when ``cell`` lies on a ``size`` × ``size`` board."""
    row, col = cell
    return 0 <= row < size and 0 <= col < size


def iter_cells(size: int) -> Iterator[Cell]:
    """Yield every cell of a ``size`` × ``size`` board in row-major order."""
    for row in range(size):
        for col in range(size):
            yield (row, col)


def orthogonal_neighbors(cell: Cell, size: int) -> list[Cell]:
    """Return the on-board orthogonal neighbors of ``cell``.

    Walls are *not* considered here; wall-aware adjacency lives in
    :class:`~.constraints.CaseGeometry`.
    """
    row, col = cell
    candidates = ((row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1))
    return [c for c in candidates if is_valid_cell(c, size)]


def normalize_edge(a: Cell, b: Cell) -> tuple[Cell, Cell]:
    """Return the canonical ordering of an edge between two adjacent cells.

    ``normalize_edge(B2, B3)`` and ``normalize_edge(B3, B2)`` produce the same
    tuple, so wall edges compare equal regardless of declaration order.
    """
    return (a, b) if a <= b else (b, a)


def cell_bit(cell: Cell, size: int) -> int:
    """Return the bitmask bit for ``cell`` on a ``size`` × ``size`` board."""
    row, col = cell
    return 1 << (row * size + col)


def bit_to_cell(bit_index: int, size: int) -> Cell:
    """Inverse of :func:`cell_bit` for a single bit index."""
    return (bit_index // size, bit_index % size)


# ---------------------------------------------------------------------------
# Direction predicates (pure coordinate math; walls never apply)
# ---------------------------------------------------------------------------


def is_north_of(a: Cell, b: Cell) -> bool:
    """``a`` is north of ``b``: strictly lower row index."""
    return a[0] < b[0]


def is_south_of(a: Cell, b: Cell) -> bool:
    """``a`` is south of ``b``: strictly higher row index."""
    return a[0] > b[0]


def is_west_of(a: Cell, b: Cell) -> bool:
    """``a`` is west of ``b``: strictly lower column index."""
    return a[1] < b[1]


def is_east_of(a: Cell, b: Cell) -> bool:
    """``a`` is east of ``b``: strictly higher column index."""
    return a[1] > b[1]


def is_directly_north_of(a: Cell, b: Cell) -> bool:
    """Same column, ``a`` strictly north of ``b`` (not necessarily adjacent)."""
    return a[1] == b[1] and a[0] < b[0]


def is_directly_south_of(a: Cell, b: Cell) -> bool:
    """Same column, ``a`` strictly south of ``b`` (not necessarily adjacent)."""
    return a[1] == b[1] and a[0] > b[0]


def is_directly_west_of(a: Cell, b: Cell) -> bool:
    """Same row, ``a`` strictly west of ``b`` (not necessarily adjacent)."""
    return a[0] == b[0] and a[1] < b[1]


def is_directly_east_of(a: Cell, b: Cell) -> bool:
    """Same row, ``a`` strictly east of ``b`` (not necessarily adjacent)."""
    return a[0] == b[0] and a[1] > b[1]


def is_orthogonally_adjacent(a: Cell, b: Cell) -> bool:
    """Return ``True`` when ``a`` and ``b`` share an edge (ignoring walls)."""
    return abs(a[0] - b[0]) + abs(a[1] - b[1]) == 1
