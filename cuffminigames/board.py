"""Board primitives, copied verbatim from crab-cogs `minigames/board.py`.

The only addition is `winning_lines` at the bottom — see its docstring for why
`find_lines`' own `result` parameter could not answer the question this cog
needs answered.
"""

from typing import Any, List, Tuple, Optional


Pos = Tuple[int, int]


class Board:
    def __init__(self, width: int, height: int, fill: Any = None):
        self.width = width
        self.height = height
        self._data = [fill] * (width * height)

    def _index(self, x: int, y: int):
        if not (0 <= x < self.width and 0 <= y < self.height):
            raise IndexError("Board index out of range")
        return y * self.width + x

    def __getitem__(self, pos: Pos):
        x, y = pos
        return self._data[self._index(x, y)]

    def __setitem__(self, pos: Pos, value: Any):
        x, y = pos
        self._data[self._index(x, y)] = value

    def copy(self):
        new_board = Board(self.width, self.height)
        new_board._data = list(self._data)
        return new_board


# These functions were originally handwritten in C# by me, and converted to Python with an LLM


def find_lines(board: Board, value: Any, length: int, result: Optional[List[Pos]] = None):
    win = False
    line: List[Pos] = []

    def check_cell(x: int, y: int):
        nonlocal win, line
        pos = (x, y)
        if board[pos] == value:
            line.append(pos)
            if len(line) >= length:
                win = True
                if result is not None:
                    if len(line) == length:
                        result.extend(line)
                    else:
                        result.append(pos)
        else:
            line = []

    # Horizontals
    for y in range(board.height):
        line = []
        for x in range(board.width):
            check_cell(x, y)

    # Verticals
    for x in range(board.width):
        line = []
        for y in range(board.height):
            check_cell(x, y)

    # Diagonals (top-left to bottom-right)
    for d in range(length - 1, board.width + board.height - length + 1):
        line = []
        for y in range(board.height):
            x = d - y
            if 0 <= x < board.width:
                check_cell(x, y)

    # Diagonals (top-right to bottom-left)
    for d in range(length - 1, board.width + board.height - length + 1):
        line = []
        for y in range(board.height):
            x = board.width - 1 - d + y
            if 0 <= x < board.width:
                check_cell(x, y)

    return win


def try_complete_line(board: Board, value: Any, empty: Any, length: int) -> Optional[Pos]:
    # Horizontals
    for y in range(board.height):
        count, missing = 0, None
        for x in range(board.width):
            if board[x, y] == value:
                count += 1
            elif board[x, y] is empty:
                missing = (x, y)
            if count == length - 1 and missing is not None:
                return missing

    # Verticals
    for x in range(board.width):
        count, missing = 0, None
        for y in range(board.height):
            if board[x, y] == value:
                count += 1
            elif board[x, y] is empty:
                missing = (x, y)
            if count == length - 1 and missing is not None:
                return missing

    # Diagonals (top-left to bottom-right)
    for d in range(length - 1, board.width + board.height - length + 1):
        count, missing = 0, None
        for y in range(board.height):
            x = d - y
            if 0 <= x < board.width:
                if board[x, y] == value:
                    count += 1
                elif board[x, y] is empty:
                    missing = (x, y)
                if count == length - 1 and missing is not None:
                    return missing

    # Diagonals (top-right to bottom-left)
    for d in range(length - 1, board.width + board.height - length + 1):
        count, missing = 0, None
        for y in range(board.height):
            x = board.width - 1 - d + y
            if 0 <= x < board.width:
                if board[x, y] == value:
                    count += 1
                elif board[x, y] is empty:
                    missing = (x, y)
                if count == length - 1 and missing is not None:
                    return missing

    return None


#: The four straight directions a line can run in. `(1, -1)` is the up-right
#: diagonal; its mirror `(-1, 1)` is the same line walked backwards, so scanning
#: only these four covers every line exactly once.
DIRECTIONS: List[Pos] = [(1, 0), (0, 1), (1, 1), (1, -1)]


def winning_lines(board: Board, value: Any, length: int) -> List[List[Pos]]:
    """Every straight run of at least `length` cells holding `value`.

    `find_lines` above answers *"is there a win"*, and its optional `result`
    parameter flattens the cells of every direction into one list — so a player
    who completes two lines at once produces a blob that cannot be told apart
    again. Highlighting a board and naming the line both need the runs kept
    separate, which is what this returns.

    A run is only started where the cell *behind* it breaks the run, so each
    line is emitted once rather than once per starting offset.
    """
    lines: List[List[Pos]] = []
    for dx, dy in DIRECTIONS:
        for y in range(board.height):
            for x in range(board.width):
                px, py = x - dx, y - dy
                if 0 <= px < board.width and 0 <= py < board.height and board[px, py] == value:
                    continue  # not the start of this run
                run: List[Pos] = []
                cx, cy = x, y
                while 0 <= cx < board.width and 0 <= cy < board.height and board[cx, cy] == value:
                    run.append((cx, cy))
                    cx, cy = cx + dx, cy + dy
                if len(run) >= length:
                    lines.append(run)
    return lines
