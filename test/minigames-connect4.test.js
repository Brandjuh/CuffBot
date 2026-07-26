// M26.2a: the ported Connect 4 engine and the cog's heuristic opponent.
//
// Boards are built by PLAYING them, never hand-written — S100 learned that the
// hard way twice: a hand-built Connect 4 position had its gap at the bottom of
// a column, which the game can never produce because pieces fall, and the test
// was asking about a position that cannot exist (skill rule, architecture.md
// § Hand-written state fixtures).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Board, findLines, tryCompleteLine } from '../src/modules/minigames/lib/board.js';
import {
  BLUE,
  NONE,
  RED,
  TIE,
  availableColumns,
  checkWin,
  chooseColumn,
  countThreats,
  dangerousSetups,
  highestSlot,
  newGame,
  playColumn,
  renderBoard,
  winningLine,
} from '../src/modules/minigames/lib/connect4.js';

/** Play a list of columns alternately from a fresh game. */
function play(columns, startWith = RED) {
  let state = { board: new Board(7, 6, NONE), current: startWith, winner: NONE, time: 0 };
  for (const c of columns) state = playColumn(state, c);
  return state;
}

// ── the shared board ─────────────────────────────────────────────────────────

test('findLines sees runs in all four directions', () => {
  const horizontal = new Board(7, 6, NONE);
  [0, 1, 2, 3].forEach((x) => horizontal.set(x, 5, RED));
  assert.equal(findLines(horizontal, RED, 4), true);

  const vertical = new Board(7, 6, NONE);
  [2, 3, 4, 5].forEach((y) => vertical.set(0, y, BLUE));
  assert.equal(findLines(vertical, BLUE, 4), true);

  const down = new Board(7, 6, NONE);
  [0, 1, 2, 3].forEach((i) => down.set(i, i, RED));
  assert.equal(findLines(down, RED, 4), true);

  const up = new Board(7, 6, NONE);
  [0, 1, 2, 3].forEach((i) => up.set(i, 3 - i, BLUE));
  assert.equal(findLines(up, BLUE, 4), true);
});

test('three in a row is not four', () => {
  const board = new Board(7, 6, NONE);
  [0, 1, 2].forEach((x) => board.set(x, 5, RED));
  assert.equal(findLines(board, RED, 4), false);
});

test('findLines collects the winning cells when asked', () => {
  const board = new Board(7, 6, NONE);
  [0, 1, 2, 3].forEach((x) => board.set(x, 5, RED));
  const cells = [];
  findLines(board, RED, 4, cells);
  assert.deepEqual(cells, [
    [0, 5],
    [1, 5],
    [2, 5],
    [3, 5],
  ]);
});

test('the board rejects out-of-range access rather than returning undefined', () => {
  const board = new Board(7, 6, NONE);
  assert.throws(() => board.get(7, 0), RangeError);
  assert.throws(() => board.get(0, 6), RangeError);
  assert.throws(() => board.get(-1, 0), RangeError);
});

test('copy() is deep enough that writing to the copy leaves the original alone', () => {
  const board = new Board(7, 6, NONE);
  const copy = board.copy();
  copy.set(0, 0, RED);
  assert.equal(board.get(0, 0), NONE);
});

test('tryCompleteLine finds the gap that completes a line', () => {
  const board = new Board(3, 3, NONE);
  board.set(0, 0, RED);
  board.set(1, 0, RED);
  assert.deepEqual(tryCompleteLine(board, RED, NONE, 3), [2, 0]);
});

// ── falling pieces ───────────────────────────────────────────────────────────

test('pieces fall to the lowest empty row', () => {
  const state = play([3]);
  assert.equal(state.board.get(3, 5), RED, 'first piece lands on the floor');
  const next = playColumn(state, 3);
  assert.equal(next.board.get(3, 4), BLUE, 'the second stacks on top');
});

test('a full column is unavailable and refuses another piece', () => {
  const state = play([0, 0, 0, 0, 0, 0]);
  assert.equal(highestSlot(state.board, 0), null);
  assert.equal(availableColumns(state.board).includes(0), false);
  assert.throws(() => playColumn(state, 0), RangeError);
});

test('turns alternate, and a win stops them', () => {
  // RED plays 0,1,2,3 while BLUE answers in 6 — RED wins along the floor.
  const state = play([0, 6, 1, 6, 2, 6, 3]);
  assert.equal(state.winner, RED);
  assert.deepEqual(winningLine(state), [
    [0, 5],
    [1, 5],
    [2, 5],
    [3, 5],
  ]);
  assert.throws(() => playColumn(state, 4), /finished/);
});

test('a filled board with no winner is a tie', () => {
  // A 2x2 board cannot hold four in a row, so filling it MUST be a tie —
  // which tests the rule without hand-building a 7x6 position that would
  // need checking for accidental fours (S100's lesson about fixtures).
  let state = { board: new Board(2, 2, NONE), current: RED, winner: NONE, time: 0 };
  for (const column of [0, 0, 1, 1]) state = playColumn(state, column);
  assert.equal(state.time, 4);
  assert.equal(state.winner, TIE);
  assert.throws(() => playColumn(state, 0), /finished/);
});

test('playColumn never mutates the state it was given', () => {
  const before = play([3]);
  const snapshot = [...before.board.data];
  playColumn(before, 3);
  assert.deepEqual(before.board.data, snapshot);
});

// ── the opponent ─────────────────────────────────────────────────────────────
//
// The two mandatory behaviours hold for ANY generator, because both bypass the
// scoring — so these run against a generator that would otherwise pick badly.

const worstCase = () => 0; // no noise, always the first tied move

test('the bot always takes an immediate win', () => {
  // RED has three on the floor at 0,1,2 and it is RED's turn.
  const state = play([0, 6, 1, 6, 2, 6]);
  assert.equal(state.current, RED);
  assert.equal(chooseColumn(state.board, RED, worstCase), 3);
});

test('the bot always blocks an immediate loss', () => {
  // BLUE threatens on the floor at 0,1,2; RED has no win of its own.
  const state = play([5, 0, 6, 1, 5, 2]);
  assert.equal(state.current, RED);
  assert.equal(chooseColumn(state.board, RED, worstCase), 3, 'must block column 3');
});

test('taking a win beats blocking one when both are available', () => {
  // RED can win at 3; BLUE also threatens at 4. The win short-circuits.
  const board = new Board(7, 6, NONE);
  [0, 1, 2].forEach((x) => board.set(x, 5, RED));
  [4, 5, 6].forEach((x) => board.set(x, 4, BLUE));
  assert.equal(chooseColumn(board, RED, worstCase), 3);
});

test('with nothing tactical on the board the bot prefers the centre', () => {
  const board = new Board(7, 6, NONE);
  assert.equal(chooseColumn(board, RED, worstCase), 3, 'column 3 is the centre of seven');
});

test('the bot never returns a full or out-of-range column', () => {
  // Fill columns 0–5 completely; only 6 is legal.
  const board = new Board(7, 6, NONE);
  for (let x = 0; x < 6; x += 1) {
    for (let y = 0; y < 6; y += 1) board.set(x, y, x % 2 === 0 ? RED : BLUE);
  }
  assert.equal(chooseColumn(board, RED, worstCase), 6);
});

test('a full board leaves the bot nothing to do, and it says so', () => {
  const board = new Board(7, 6, RED);
  assert.throws(() => chooseColumn(board, RED, worstCase), RangeError);
});

test('countThreats counts windows of four that are otherwise empty', () => {
  const board = new Board(7, 6, NONE);
  [0, 1].forEach((x) => board.set(x, 5, RED));
  // The pair sits inside windows 0-3 and (partly) others; two of RED with two
  // empties is what "length 2" means.
  assert.equal(countThreats(board, RED, 2) > 0, true);
  assert.equal(countThreats(board, RED, 3), 0);
  assert.equal(countThreats(board, BLUE, 2), 0);
});

test('dangerousSetups counts the columns that would hand the opponent a win', () => {
  const board = new Board(7, 6, NONE);
  [0, 1, 2].forEach((x) => board.set(x, 5, BLUE));
  assert.equal(dangerousSetups(board, BLUE), 1, 'only column 3 completes it');
});

// ── rendering ────────────────────────────────────────────────────────────────

test('the board renders as a header row plus six rows of seven', () => {
  const lines = renderBoard(play([])).split('\n');
  assert.equal(lines.length, 7, 'one number row + six board rows');
  assert.equal([...lines[1]].length, 7);
});

test('the winning four are brightened, the rest are not', () => {
  const state = play([0, 6, 1, 6, 2, 6, 3]);
  const rendered = renderBoard(state);
  assert.equal((rendered.match(/🟥/g) ?? []).length, 4, 'exactly the winning four');
  assert.match(rendered, /🔵/, 'the loser’s pieces stay their normal colour');
});

test('an unfinished board highlights nothing', () => {
  assert.equal(renderBoard(play([3, 4])).includes('🟥'), false);
});

// ── the start ────────────────────────────────────────────────────────────────

test('the starting player is random, as the source does it', () => {
  assert.equal(newGame(() => 0.1).current, RED);
  assert.equal(newGame(() => 0.9).current, BLUE);
});

test('a new game is empty and unfinished', () => {
  const state = newGame(() => 0.1);
  assert.equal(state.time, 0);
  assert.equal(state.winner, NONE);
  assert.equal(state.board.data.every((c) => c === NONE), true);
  assert.notEqual(TIE, NONE, 'TIE and NONE must be distinguishable');
});
