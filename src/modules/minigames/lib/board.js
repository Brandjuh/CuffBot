// A generic grid + line finder, ported from `minigames/board.py` in
// Brandjuh/FireAndRescueAcademyCogs (M26.2, owner: "Vervang deze met …").
//
// The cog's own comment says these functions were "originally handwritten in
// C# by me, and converted to Python with an LLM" — so this is the third
// translation. The scan ORDER is preserved exactly (horizontals, verticals,
// then both diagonal families) because `findLines` reports the FIRST line it
// completes, and a reordered scan would highlight a different set of four on
// a board that happens to contain two.
//
// Pure: plain numbers in, plain numbers out. No discord.js.

/** A width × height grid stored as one flat array, like the source. */
export class Board {
  constructor(width, height, fill = null) {
    this.width = width;
    this.height = height;
    this.data = new Array(width * height).fill(fill);
  }

  #index(x, y) {
    if (!(x >= 0 && x < this.width && y >= 0 && y < this.height)) {
      throw new RangeError('Board index out of range');
    }
    return y * this.width + x;
  }

  get(x, y) {
    return this.data[this.#index(x, y)];
  }

  set(x, y, value) {
    this.data[this.#index(x, y)] = value;
  }

  copy() {
    const next = new Board(this.width, this.height);
    next.data = [...this.data];
    return next;
  }
}

/**
 * Is there a run of `length` cells holding `value`? Optionally collect it.
 *
 * The source mutates a shared `line` list from a closure and resets it between
 * scan directions; that is reproduced rather than rewritten, because the exact
 * reset points decide which cells land in `result` when a run is longer than
 * `length` (the source appends only the overhanging cell in that case).
 */
export function findLines(board, value, length, result = null) {
  let win = false;
  let line = [];

  const checkCell = (x, y) => {
    if (board.get(x, y) === value) {
      line.push([x, y]);
      if (line.length >= length) {
        win = true;
        if (result) {
          if (line.length === length) result.push(...line);
          else result.push([x, y]);
        }
      }
    } else {
      line = [];
    }
  };

  for (let y = 0; y < board.height; y += 1) {
    line = [];
    for (let x = 0; x < board.width; x += 1) checkCell(x, y);
  }
  for (let x = 0; x < board.width; x += 1) {
    line = [];
    for (let y = 0; y < board.height; y += 1) checkCell(x, y);
  }
  // Top-left → bottom-right.
  for (let d = length - 1; d < board.width + board.height - length + 1; d += 1) {
    line = [];
    for (let y = 0; y < board.height; y += 1) {
      const x = d - y;
      if (x >= 0 && x < board.width) checkCell(x, y);
    }
  }
  // Top-right → bottom-left.
  for (let d = length - 1; d < board.width + board.height - length + 1; d += 1) {
    line = [];
    for (let y = 0; y < board.height; y += 1) {
      const x = board.width - 1 - d + y;
      if (x >= 0 && x < board.width) checkCell(x, y);
    }
  }
  return win;
}

/**
 * The one empty cell that would complete a line for `value`, or null.
 *
 * Used by Tic-Tac-Toe's opponent. Note the source's quirk, kept deliberately:
 * `count` and `missing` are not reset when a run is broken by an ENEMY piece,
 * so a row like `X X O _` can still report the gap. It is a weaker player than
 * a correct implementation would be — which is the point, since the owner
 * chose this opponent over ours knowing it is the weaker one.
 */
export function tryCompleteLine(board, value, empty, length) {
  const scan = (cells) => {
    let count = 0;
    let missing = null;
    for (const [x, y] of cells) {
      const cell = board.get(x, y);
      if (cell === value) count += 1;
      else if (cell === empty) missing = [x, y];
      if (count === length - 1 && missing !== null) return missing;
    }
    return null;
  };

  for (let y = 0; y < board.height; y += 1) {
    const hit = scan([...Array(board.width).keys()].map((x) => [x, y]));
    if (hit) return hit;
  }
  for (let x = 0; x < board.width; x += 1) {
    const hit = scan([...Array(board.height).keys()].map((y) => [x, y]));
    if (hit) return hit;
  }
  for (let d = length - 1; d < board.width + board.height - length + 1; d += 1) {
    const cells = [];
    for (let y = 0; y < board.height; y += 1) {
      const x = d - y;
      if (x >= 0 && x < board.width) cells.push([x, y]);
    }
    const hit = scan(cells);
    if (hit) return hit;
  }
  for (let d = length - 1; d < board.width + board.height - length + 1; d += 1) {
    const cells = [];
    for (let y = 0; y < board.height; y += 1) {
      const x = board.width - 1 - d + y;
      if (x >= 0 && x < board.width) cells.push([x, y]);
    }
    const hit = scan(cells);
    if (hit) return hit;
  }
  return null;
}
