// Connect 4, ported from `minigames/connect4.py` (M26.2).
//
// The owner asked for this cog to REPLACE the S71/S100 module, and chose
// "alles van de cog, ook hun bot" with the trade-off stated: the opponent
// below is a scoring heuristic, and it is measurably weaker than the negamax
// with alpha-beta it retires. It is therefore ported VERBATIM — the weights,
// the ±2 randomness, the tie-break over equal-scoring columns and all — rather
// than improved. Quietly keeping the stronger AI behind this interface would
// deliver something the owner explicitly declined.
//
// Pure: `random` is injected, so a whole game is reproducible in a test.
import { Board, findLines } from './board.js';

export const NONE = -1;
export const RED = 0;
export const BLUE = 1;
export const TIE = -2;

export const WIDTH = 7;
export const HEIGHT = 6;
export const CONNECT = 4;

export const EMOJIS = { [NONE]: '⚫', [RED]: '🔴', [BLUE]: '🔵' };
export const COLORS = { [TIE]: 0x78b159, [NONE]: 0x31373d, [RED]: 0xdd2e44, [BLUE]: 0x55acee };
export const NUMBERS = ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣'];

export const opponentOf = (current) => (current === RED ? BLUE : RED);

export const newBoard = () => new Board(WIDTH, HEIGHT, NONE);

/** Lowest empty row in a column (pieces fall), or null when it is full. */
export function highestSlot(board, column) {
  if (column < 0 || column > board.width - 1) throw new RangeError('Invalid column');
  for (let row = board.height - 1; row >= 0; row -= 1) {
    if (board.get(column, row) === NONE) return row;
  }
  return null;
}

export function dropPiece(board, column, color) {
  const row = highestSlot(board, column);
  if (row === null) throw new RangeError('Column is full');
  board.set(column, row, color);
  return row;
}

export const availableColumns = (board) =>
  [...Array(board.width).keys()].filter((c) => highestSlot(board, c) !== null);

export const checkWin = (board, color) => findLines(board, color, CONNECT);

/**
 * How many windows of 4 hold exactly `length` of `color` and are otherwise
 * empty — the source's `count_threats`, window-for-window.
 */
export function countThreats(board, color, length) {
  let count = 0;
  const consider = (cells) => {
    const window = cells.map(([x, y]) => board.get(x, y));
    const mine = window.filter((c) => c === color).length;
    const empty = window.filter((c) => c === NONE).length;
    if (mine === length && empty === CONNECT - length) count += 1;
  };
  for (let y = 0; y < board.height; y += 1) {
    for (let x = 0; x < board.width - 3; x += 1) consider([0, 1, 2, 3].map((i) => [x + i, y]));
  }
  for (let x = 0; x < board.width; x += 1) {
    for (let y = 0; y < board.height - 3; y += 1) consider([0, 1, 2, 3].map((i) => [x, y + i]));
  }
  for (let x = 0; x < board.width - 3; x += 1) {
    for (let y = 3; y < board.height; y += 1) consider([0, 1, 2, 3].map((i) => [x + i, y - i]));
  }
  for (let x = 0; x < board.width - 3; x += 1) {
    for (let y = 0; y < board.height - 3; y += 1) consider([0, 1, 2, 3].map((i) => [x + i, y + i]));
  }
  return count;
}

/** How many columns would let `opponent` win on their next move. */
export function dangerousSetups(board, opponent) {
  let danger = 0;
  for (const column of availableColumns(board)) {
    const temp = board.copy();
    dropPiece(temp, column, opponent);
    if (checkWin(temp, opponent)) danger += 1;
  }
  return danger;
}

/**
 * The cog's opponent. Ported weight-for-weight:
 *   an immediate win is taken at once; blocking one scores 900; own 3-in-a-rows
 *   100 each and 2-in-a-rows 10; the opponent's existing 3s and 2s 50 and 5;
 *   every column that would hand them a next-turn win costs 200; the centre is
 *   worth 3 per step closer. Then ±2 of noise, and a random pick among ties.
 *
 * The noise is why `random` is a parameter: with a fixed generator a test can
 * assert the exact column, and the mandatory behaviours (always take a win,
 * always block one) hold for ANY generator because both bypass the scoring.
 */
export function chooseColumn(board, current, random = Math.random) {
  const columns = availableColumns(board);
  if (columns.length === 0) throw new RangeError('No available columns');
  if (columns.length === 1) return columns[0];

  const opponent = opponentOf(current);
  let bestScore = -Infinity;
  let bestMoves = [];

  for (const column of columns) {
    const mine = board.copy();
    dropPiece(mine, column, current);
    // An immediate win short-circuits the whole scan, exactly as the source
    // returns from inside its loop — so a winning column later in the scan
    // never gets the chance to be out-scored by an earlier one.
    if (checkWin(mine, current)) return column;

    let score = 0;
    const theirs = board.copy();
    dropPiece(theirs, column, opponent);
    if (checkWin(theirs, opponent)) score += 900;

    score += countThreats(mine, current, 3) * 100;
    score += countThreats(mine, current, 2) * 10;
    score += countThreats(board, opponent, 3) * 50;
    score += countThreats(board, opponent, 2) * 5;
    score -= dangerousSetups(mine, opponent) * 200;
    score += (3 - Math.abs(column - 3)) * 3;
    score += random() * 4 - 2; // the source's random.uniform(-2, 2)

    if (score > bestScore) {
      bestScore = score;
      bestMoves = [column];
    } else if (score === bestScore) {
      bestMoves.push(column);
    }
  }
  return bestMoves[Math.floor(random() * bestMoves.length)];
}

/**
 * Play a column. Returns the new state; never mutates `state`.
 *
 * @param {{board: Board, current: number, winner: number, time: number}} state
 */
export function playColumn(state, column) {
  if (state.winner !== NONE) throw new Error('This game is finished');
  const board = state.board.copy();
  dropPiece(board, column, state.current);
  const time = state.time + 1;

  if (checkWin(board, state.current)) {
    return { ...state, board, time, winner: state.current };
  }
  // A full board with no winner is a tie. `time` counts placements, so it
  // equals the cell count exactly when the last slot is filled.
  if (time === board.width * board.height) {
    return { ...state, board, time, winner: TIE };
  }
  return { ...state, board, time, current: opponentOf(state.current) };
}

export function newGame(random = Math.random) {
  return {
    board: newBoard(),
    current: random() < 0.5 ? RED : BLUE, // the source's random starting player
    winner: NONE,
    time: 0,
  };
}

/** The four cells that won, for highlighting. Empty when nobody has won. */
export function winningLine(state) {
  if (state.winner < 0) return [];
  const w = state.winner;
  const b = state.board;
  for (let y = 0; y < b.height; y += 1) {
    for (let x = 0; x < b.width - 3; x += 1) {
      if ([0, 1, 2, 3].every((i) => b.get(x + i, y) === w)) return [0, 1, 2, 3].map((i) => [x + i, y]);
    }
  }
  for (let x = 0; x < b.width; x += 1) {
    for (let y = 0; y < b.height - 3; y += 1) {
      if ([0, 1, 2, 3].every((i) => b.get(x, y + i) === w)) return [0, 1, 2, 3].map((i) => [x, y + i]);
    }
  }
  for (let x = 0; x < b.width - 3; x += 1) {
    for (let y = 3; y < b.height; y += 1) {
      if ([0, 1, 2, 3].every((i) => b.get(x + i, y - i) === w)) return [0, 1, 2, 3].map((i) => [x + i, y - i]);
    }
  }
  for (let x = 0; x < b.width - 3; x += 1) {
    for (let y = 0; y < b.height - 3; y += 1) {
      if ([0, 1, 2, 3].every((i) => b.get(x + i, y + i) === w)) return [0, 1, 2, 3].map((i) => [x + i, y + i]);
    }
  }
  return [];
}

/** The emoji grid, with the winning four brightened like the source does. */
export function renderBoard(state) {
  const winning = new Set(winningLine(state).map(([x, y]) => `${x},${y}`));
  const rows = [NUMBERS.slice(0, state.board.width).join('')];
  for (let y = 0; y < state.board.height; y += 1) {
    let row = '';
    for (let x = 0; x < state.board.width; x += 1) {
      const cell = state.board.get(x, y);
      if (winning.has(`${x},${y}`)) row += cell === RED ? '🟥' : '🟦';
      else row += EMOJIS[cell];
    }
    rows.push(row);
  }
  return rows.join('\n');
}
