// M26.2b: Tic-Tac-Toe on M26.2a's frame.
//
// The rules are pure, so a whole game plays in one expression. `random` is
// injected everywhere, which is what makes the opponent's behaviour assertable
// rather than observed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CIRCLE,
  CROSS,
  NONE,
  SLOTS,
  TIE,
  chooseSlot,
  emptySlots,
  newBoard,
  newGame,
  opponentOf,
  playSlot,
  slotToXY,
  winningLine,
  xyToSlot,
} from '../src/modules/minigames/lib/tictactoe.js';
import { ticTacToePanel } from '../src/modules/minigames/lib/panel.js';

const fixed = (value) => () => value;

/** Start from a chosen mark so a scripted game is deterministic. */
const start = (current = CROSS) => ({ board: newBoard(), current, winner: NONE, time: 0 });

/** Play a list of slots in order. */
const run = (slots, current = CROSS) => slots.reduce((state, slot) => playSlot(state, slot), start(current));

// ── the grid ─────────────────────────────────────────────────────────────────

test('slot indices are reading order, the source’s y*3 + x', () => {
  assert.deepEqual(slotToXY(0), [0, 0]);
  assert.deepEqual(slotToXY(4), [1, 1]);
  assert.deepEqual(slotToXY(8), [2, 2]);
  for (let slot = 0; slot < SLOTS; slot += 1) {
    const [x, y] = slotToXY(slot);
    assert.equal(xyToSlot(x, y), slot, `slot ${slot} does not round-trip`);
  }
});

test('an empty board has nine free slots, and each move takes one', () => {
  let state = start();
  assert.equal(emptySlots(state.board).length, 9);
  state = playSlot(state, 4);
  assert.deepEqual(emptySlots(state.board), [0, 1, 2, 3, 5, 6, 7, 8]);
});

// ── the rules ────────────────────────────────────────────────────────────────

test('turns alternate', () => {
  let state = start(CROSS);
  assert.equal(state.current, CROSS);
  state = playSlot(state, 0);
  assert.equal(state.current, CIRCLE);
  state = playSlot(state, 1);
  assert.equal(state.current, CROSS);
});

test('three in a row wins — row, column and both diagonals', () => {
  assert.equal(run([0, 3, 1, 4, 2]).winner, CROSS, 'top row');
  assert.equal(run([0, 1, 3, 2, 6]).winner, CROSS, 'left column');
  assert.equal(run([0, 1, 4, 2, 8]).winner, CROSS, 'main diagonal');
  assert.equal(run([2, 0, 4, 1, 6]).winner, CROSS, 'anti-diagonal');
});

test('a full board with no line is a tie', () => {
  // X O X / X O O / O X X — nine marks, no three in a row.
  const state = run([0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.equal(state.time, 9);
  assert.equal(state.winner, TIE);
});

test('the winner is decided before the board fills, so a ninth move cannot overwrite it', () => {
  const won = run([0, 3, 1, 4, 2]);
  assert.equal(won.winner, CROSS);
  assert.equal(won.time, 5, 'the game stopped the moment the line completed');
  assert.throws(() => playSlot(won, 5), /finished/);
});

test('a taken square and an out-of-range slot are both refused', () => {
  const state = playSlot(start(), 4);
  assert.throws(() => playSlot(state, 4), /already taken/);
  assert.throws(() => playSlot(state, 9), /Slot must be/);
  assert.throws(() => playSlot(state, -1), /Slot must be/);
  assert.throws(() => playSlot(state, 1.5), /Slot must be/);
});

test('playSlot never mutates the state it was given', () => {
  const before = start();
  const after = playSlot(before, 0);
  assert.equal(before.time, 0);
  assert.equal(before.board.get(0, 0), NONE);
  assert.equal(after.board.get(0, 0), CROSS);
});

test('the opener is random — the cog always starts CROSS, which we do not', () => {
  // The cog hard-codes `self.current = Player.CROSS`, so the challenger always
  // moves first. In a 3×3 game that is a real edge, and these games are staked.
  assert.equal(newGame(fixed(0.2)).current, CROSS);
  assert.equal(newGame(fixed(0.8)).current, CIRCLE);
});

test('opponentOf flips, and only between the two marks', () => {
  assert.equal(opponentOf(CROSS), CIRCLE);
  assert.equal(opponentOf(CIRCLE), CROSS);
});

// ── the opponent ─────────────────────────────────────────────────────────────

test('the bot takes an immediate win', () => {
  // CROSS holds 0 and 1; slot 2 completes the top row.
  const state = run([0, 6, 1, 7]);
  assert.equal(state.current, CROSS);
  assert.equal(chooseSlot(state.board, CROSS, fixed(0)), 2);
});

test('the bot blocks when it cannot win', () => {
  // CIRCLE to move; CROSS threatens the top row at slot 2 and CIRCLE has
  // nothing of its own to complete.
  const state = run([0, 6, 1]);
  assert.equal(state.current, CIRCLE);
  assert.equal(chooseSlot(state.board, CIRCLE, fixed(0)), 2);
});

test('winning beats blocking when both are available', () => {
  // CROSS can finish the top row at 2; CIRCLE threatens the bottom at 8.
  let state = start(CROSS);
  for (const [slot, mark] of [[0, CROSS], [1, CROSS], [6, CIRCLE], [7, CIRCLE]]) {
    const [x, y] = slotToXY(slot);
    state.board.set(x, y, mark);
  }
  assert.equal(chooseSlot(state.board, CROSS, fixed(0)), 2, 'take the win, do not block');
});

test('with nothing to win or block, the bot plays a free slot', () => {
  const state = start();
  const picked = chooseSlot(state.board, CROSS, fixed(0));
  assert.ok(emptySlots(state.board).includes(picked));
  // The choice is `free[floor(random * free.length)]`, so a fixed generator
  // pins it exactly — which also proves the randomness is real.
  assert.equal(chooseSlot(state.board, CROSS, fixed(0)), 0);
  assert.equal(chooseSlot(state.board, CROSS, fixed(0.99)), 8);
});

test('the bot never picks a taken square, however the generator behaves', () => {
  let state = start();
  for (const slot of [0, 1, 2, 3]) {
    const [x, y] = slotToXY(slot);
    state.board.set(x, y, slot % 2 === 0 ? CROSS : CIRCLE);
  }
  for (const r of [0, 0.25, 0.5, 0.75, 0.99]) {
    assert.ok(emptySlots(state.board).includes(chooseSlot(state.board, CROSS, fixed(r))), `random=${r}`);
  }
});

test('a full board leaves the bot nothing to do, and it says so', () => {
  const full = run([0, 1, 2, 4, 3, 5, 7, 6, 8]);
  assert.throws(() => chooseSlot(full.board, CROSS, fixed(0)), /No empty slots/);
});

// ── the winning line ─────────────────────────────────────────────────────────

test('the winning three are reported for highlighting', () => {
  assert.deepEqual(winningLine(run([0, 3, 1, 4, 2])), [[0, 0], [1, 0], [2, 0]]);
  assert.deepEqual(winningLine(run([0, 1, 4, 2, 8])), [[0, 0], [1, 1], [2, 2]]);
});

test('an unfinished or tied game highlights nothing', () => {
  assert.deepEqual(winningLine(start()), []);
  assert.deepEqual(winningLine(run([0, 1, 2, 4, 3, 5, 7, 6, 8])), [], 'a tie has no line');
});

// ── the panel ────────────────────────────────────────────────────────────────

const HUMAN_A = { id: '1', name: 'Rook', bot: false };
const HUMAN_B = { id: '2', name: 'Vance', bot: false };

const game = (over = {}) => ({
  game: 'tictactoe',
  players: [HUMAN_A, HUMAN_B],
  accepted: true,
  cancelled: false,
  againstBot: false,
  stake: { amount: 0, winAmount: 0, taken: false },
  state: start(),
  ...over,
});

test('the board IS the buttons — nine of them, three to a row', () => {
  const panel = ticTacToePanel(game());
  assert.equal(panel.buttons.length, 9);
  assert.equal(panel.perRow, 3, 'five per row would not look like a 3×3 board');
  assert.equal(panel.buttons.every((b) => b.id.startsWith('slot:')), true);
});

test('a taken square shows its mark and cannot be pressed again', () => {
  const panel = ticTacToePanel(game({ state: run([4]) }));
  const centre = panel.buttons[4];
  assert.equal(centre.emoji, '❌');
  assert.equal(centre.disabled, true);
  assert.equal(panel.buttons[0].disabled, false, 'the empty ones stay live');
});

test('the winning three are highlighted', () => {
  const panel = ticTacToePanel(game({ state: run([0, 3, 1, 4, 2]) }));
  assert.deepEqual([0, 1, 2].map((i) => panel.buttons[i].style), ['success', 'success', 'success']);
  assert.equal(panel.buttons[3].style, 'secondary');
});

test('a finished game KEEPS the board and adds a rematch under it', () => {
  // Connect 4 can drop its buttons on finish because its board is drawn in the
  // embed text. Tic-Tac-Toe's board IS the buttons, so dropping them would
  // delete the finished game from the screen — and the winning highlight with
  // it. The source keeps them too.
  const panel = ticTacToePanel(game({ state: run([0, 3, 1, 4, 2]) }));
  assert.equal(panel.buttons.length, 10);
  assert.equal(panel.buttons.at(-1).id, 'rematch');
  assert.equal(panel.buttons.slice(0, 9).every((b) => b.disabled), true, 'nothing is playable any more');
  assert.equal(panel.done, true);
  assert.match(panel.embed.title, /Rook wins/);
});

test('an unaccepted invitation shows Accept/Decline, not a board', () => {
  const panel = ticTacToePanel(game({ accepted: false }));
  assert.deepEqual(panel.buttons.map((b) => b.id), ['accept', 'decline']);
  assert.match(panel.embed.description, /<@2> — press \*\*Accept\*\*/);
});

test('a tie says so rather than naming a winner', () => {
  const panel = ticTacToePanel(game({ state: run([0, 1, 2, 4, 3, 5, 7, 6, 8]) }));
  assert.match(panel.embed.title, /a tie/);
  assert.doesNotMatch(panel.embed.description, /👑/);
});

test('the two marks are told apart by colour, unlike the source', () => {
  // The cog gives CROSS and CIRCLE the same red, which reads as a bug with two
  // players on screen.
  const cross = ticTacToePanel(game({ state: run([0, 3, 1, 4, 2], CROSS) })).embed.color;
  const circle = ticTacToePanel(game({ state: run([0, 3, 1, 4, 2], CIRCLE) })).embed.color;
  assert.notEqual(cross, circle);
});
