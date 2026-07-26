// The solo opponent (S100 = M23, owner request: "voeg een solo mode toe
// waarbij je tegen de bot speelt"). Pure — same board the duel already uses,
// no discord.js, no timing — so it is tested against fixed positions.
//
// Shape: an explicit tactical layer (take the win, block the loss) sitting on
// top of a negamax search. The search alone would find both at depth ≥ 2, but
// stating them separately means **every** difficulty is correct about them —
// including `easy`, which searches one ply and would otherwise walk into a
// loss it could see.
import { COLS, ROWS, isWinningMove } from './board.js';

/** Difficulty = search depth. The board is tiny; even `hard` is instant. */
export const DIFFICULTIES = { easy: 1, normal: 4, hard: 6 };
export const DEFAULT_DIFFICULTY = 'normal';

const WIN_SCORE = 100_000;
// Centre-out ordering: the middle column sits in the most winning lines, so it
// is both the better move and the better first guess for alpha-beta pruning.
const COLUMN_ORDER = [3, 2, 4, 1, 5, 0, 6];

export const otherDisc = (disc) => (disc === 1 ? 2 : 1);

/** Columns that still have room, centre-first. */
export function legalMoves(board) {
  return COLUMN_ORDER.filter((col) => board[0][col] === 0);
}

/** Drop into `col`, returning the landed row (or -1). Mutates — see undrop. */
function drop(board, col, disc) {
  for (let row = ROWS - 1; row >= 0; row -= 1) {
    if (board[row][col] === 0) {
      board[row][col] = disc;
      return row;
    }
  }
  return -1;
}

const undrop = (board, row, col) => {
  board[row][col] = 0;
};

/** Would `disc` win outright by playing `col`? */
export function winsWith(board, col, disc) {
  const row = drop(board, col, disc);
  if (row === -1) return false;
  const won = isWinningMove(board, row, col);
  undrop(board, row, col);
  return won;
}

// ── evaluation ───────────────────────────────────────────────────────────────

/** Every 4-cell window on the board, precomputed once. */
const WINDOWS = (() => {
  const windows = [];
  const dirs = [
    [0, 1],
    [1, 0],
    [1, 1],
    [1, -1],
  ];
  for (let row = 0; row < ROWS; row += 1) {
    for (let col = 0; col < COLS; col += 1) {
      for (const [dr, dc] of dirs) {
        const cells = [];
        for (let i = 0; i < 4; i += 1) {
          const r = row + dr * i;
          const c = col + dc * i;
          if (r < 0 || r >= ROWS || c < 0 || c >= COLS) break;
          cells.push([r, c]);
        }
        if (cells.length === 4) windows.push(cells);
      }
    }
  }
  return windows;
})();

/**
 * Positive is good for `disc`. A window holding both colours is dead and
 * scores nothing — which is the whole point of counting windows rather than
 * counting pieces.
 */
export function evaluate(board, disc) {
  const them = otherDisc(disc);
  let score = 0;
  for (const cells of WINDOWS) {
    let mine = 0;
    let theirs = 0;
    for (const [r, c] of cells) {
      const cell = board[r][c];
      if (cell === disc) mine += 1;
      else if (cell === them) theirs += 1;
    }
    if (mine && theirs) continue; // contested — worthless to both
    if (mine === 3) score += 50;
    else if (mine === 2) score += 5;
    else if (theirs === 3) score -= 60; // fear a loss slightly more than covet a win
    else if (theirs === 2) score -= 5;
  }
  // Centre control, the standard Connect 4 heuristic.
  for (let row = 0; row < ROWS; row += 1) {
    if (board[row][3] === disc) score += 3;
    else if (board[row][3] === them) score -= 3;
  }
  return score;
}

// ── search ───────────────────────────────────────────────────────────────────

/**
 * Negamax with alpha-beta. Returns a score from `disc`'s point of view.
 * A win found sooner scores higher than the same win found later, so the bot
 * finishes a game instead of shuffling.
 */
function negamax(board, disc, depth, alpha, beta) {
  const moves = legalMoves(board);
  if (moves.length === 0) return 0; // drawn

  for (const col of moves) {
    if (winsWith(board, col, disc)) return WIN_SCORE + depth;
  }
  if (depth === 0) return evaluate(board, disc);

  let best = -Infinity;
  for (const col of moves) {
    const row = drop(board, col, disc);
    const score = -negamax(board, otherDisc(disc), depth - 1, -beta, -alpha);
    undrop(board, row, col);
    if (score > best) best = score;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break; // this branch cannot improve on what we have
  }
  return best;
}

/**
 * The bot's move: a column index, or -1 when the board is full.
 *
 * Order of reasoning, deliberately explicit:
 *   1. Play a winning move if one exists.
 *   2. Otherwise block the opponent's winning move.
 *   3. Otherwise search.
 *
 * Steps 1–2 are what the search would find anyway at depth ≥ 2 — stating them
 * makes `easy` correct too, and makes both properties testable in isolation
 * rather than inferred from a search result.
 *
 * @param {number[][]} board the live board (never mutated — a copy is searched)
 * @param {1|2} disc which colour the bot plays
 * @param {{ depth?: number, random?: () => number }} [options]
 */
export function chooseMove(board, disc, { depth = DIFFICULTIES[DEFAULT_DIFFICULTY], random } = {}) {
  const work = board.map((row) => [...row]);
  const moves = legalMoves(work);
  if (moves.length === 0) return -1;

  for (const col of moves) if (winsWith(work, col, disc)) return col;
  const them = otherDisc(disc);
  for (const col of moves) if (winsWith(work, col, them)) return col;

  // Depth 0 (or a nonsense depth) means "no lookahead": pick among the legal
  // columns, centre-first unless a random source says otherwise.
  if (!(depth >= 1)) return random ? moves[Math.floor(random() * moves.length)] : moves[0];

  let bestCol = moves[0];
  let bestScore = -Infinity;
  for (const col of moves) {
    const row = drop(work, col, disc);
    const score = -negamax(work, them, depth - 1, -Infinity, Infinity);
    undrop(work, row, col);
    if (score > bestScore) {
      bestScore = score;
      bestCol = col;
    }
  }
  return bestCol;
}

/** Resolve a difficulty word to a depth; unknown words fall back to normal. */
export const depthFor = (name) => DIFFICULTIES[String(name ?? '').toLowerCase()] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
