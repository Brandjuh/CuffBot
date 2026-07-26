// Tic-Tac-Toe, ported from `minigames/tictactoe.py` (M26.2b).
//
// The second game on the frame M26.2a built: the same `Board`, the same
// `findLines`, and `tryCompleteLine` — which existed in board.js since S116
// with a comment saying it was for this opponent, and had no caller until now.
//
// Pure: `random` is injected, so a whole game is reproducible in a test.
import { Board, findLines, tryCompleteLine } from './board.js';

export const NONE = -1;
export const CROSS = 0;
export const CIRCLE = 1;
export const TIE = -2;

export const SIZE = 3;
export const CONNECT = 3;
export const SLOTS = SIZE * SIZE;

export const EMOJIS = { [NONE]: '▪️', [CROSS]: '❌', [CIRCLE]: '⭕' };
// The source gives CROSS and CIRCLE the same red; that reads as a bug when two
// players are on screen, so CIRCLE takes the blue Connect 4 already uses for
// seat 1. Recorded rather than silent: it is a deliberate divergence.
export const COLORS = { [TIE]: 0x78b159, [NONE]: 0x31373d, [CROSS]: 0xdd2e44, [CIRCLE]: 0x55acee };

export const opponentOf = (current) => (current === CROSS ? CIRCLE : CROSS);

export const newBoard = () => new Board(SIZE, SIZE, NONE);

/** Slot index (0–8, reading order) ↔ coordinates, the source's `y*3 + x`. */
export const slotToXY = (slot) => [slot % SIZE, Math.floor(slot / SIZE)];
export const xyToSlot = (x, y) => y * SIZE + x;

export const emptySlots = (board) =>
  [...Array(SLOTS).keys()].filter((slot) => {
    const [x, y] = slotToXY(slot);
    return board.get(x, y) === NONE;
  });

export const checkWin = (board, mark) => findLines(board, mark, CONNECT);

/**
 * The cog's opponent, in its own three lines: complete your own line, else
 * block theirs, else play a random empty slot.
 *
 * No lookahead at all — it will happily walk into a fork. That is the opponent
 * the owner chose ("alles van de cog, ook hun bot"), so it is ported as-is.
 */
export function chooseSlot(board, current, random = Math.random) {
  const target =
    tryCompleteLine(board, current, NONE, CONNECT) ??
    tryCompleteLine(board, opponentOf(current), NONE, CONNECT) ??
    null;
  if (target) return xyToSlot(target[0], target[1]);

  const free = emptySlots(board);
  if (free.length === 0) throw new RangeError('No empty slots');
  return free[Math.floor(random() * free.length)];
}

/**
 * Play a slot. Returns the new state; never mutates `state`.
 *
 * @param {{board: Board, current: number, winner: number, time: number}} state
 */
export function playSlot(state, slot) {
  if (state.winner !== NONE) throw new Error('This game is finished');
  if (!Number.isInteger(slot) || slot < 0 || slot >= SLOTS) {
    throw new RangeError(`Slot must be 0–${SLOTS - 1}, not ${slot}`);
  }
  const [x, y] = slotToXY(slot);
  if (state.board.get(x, y) !== NONE) throw new RangeError(`Slot ${slot} is already taken`);

  const board = state.board.copy();
  board.set(x, y, state.current);
  const time = state.time + 1;

  if (checkWin(board, state.current)) return { ...state, board, time, winner: state.current };
  // The source checks `time == 9` for the tie, which is the same test as "no
  // empty slots" but does not have to scan the board.
  if (time === SLOTS) return { ...state, board, time, winner: TIE };
  return { ...state, board, time, current: opponentOf(state.current) };
}

/**
 * A fresh game.
 *
 * ⚠️ **Divergence from the source, deliberate:** the cog hard-codes
 * `self.current = Player.CROSS`, so the challenger ALWAYS moves first — a real
 * advantage in a 3×3 game (perfect play by the first player never loses). Its
 * own Connect 4 randomises the opener. We randomise here too, for the same
 * reason M26.2a's rematch swaps seats: a game that one seat can only draw or
 * win is not worth staking donuts on.
 */
export function newGame(random = Math.random) {
  return {
    board: newBoard(),
    current: random() < 0.5 ? CROSS : CIRCLE,
    winner: NONE,
    time: 0,
  };
}

/** The three winning cells, for highlighting. Empty when nobody has won. */
export function winningLine(state) {
  if (state.winner < 0) return [];
  const w = state.winner;
  const b = state.board;
  const lines = [];
  for (let y = 0; y < SIZE; y += 1) lines.push([0, 1, 2].map((x) => [x, y]));
  for (let x = 0; x < SIZE; x += 1) lines.push([0, 1, 2].map((y) => [x, y]));
  lines.push([0, 1, 2].map((i) => [i, i]));
  lines.push([0, 1, 2].map((i) => [i, SIZE - 1 - i]));
  return lines.find((cells) => cells.every(([x, y]) => b.get(x, y) === w)) ?? [];
}
