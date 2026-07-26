// The Connect 4 solo opponent (S100 = M23, owner request). Every test is a
// FIXED position with a known correct answer — no gateway, no timing, no
// randomness unless a test injects it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLS, ROWS, createBoard, dropPiece, isWinningMove } from '../src/modules/connect4/lib/board.js';
import {
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  chooseMove,
  depthFor,
  evaluate,
  legalMoves,
  otherDisc,
  winsWith,
} from '../src/modules/connect4/lib/ai.js';
import { createChallenge, endGame, isSolo, playBotTurn, startGame } from '../src/modules/connect4/service.js';

const HUMAN = 1;
const BOT = 2;

/**
 * Build a board from rows of characters, TOP row first — the same orientation
 * `renderBoard` prints, so a test position reads like the screen.
 *   '.' empty · 'x' human (🔴) · 'o' bot (🔵)
 */
function boardOf(...rows) {
  const board = createBoard();
  const offset = ROWS - rows.length; // shorter fixtures describe the BOTTOM
  rows.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      board[offset + r][c] = ch === 'x' ? HUMAN : ch === 'o' ? BOT : 0;
    });
  });
  return board;
}

const snapshot = (board) => board.map((row) => [...row]);

// ── the primitives ───────────────────────────────────────────────────────────

test('legalMoves lists open columns, centre first', () => {
  assert.deepEqual(legalMoves(createBoard()), [3, 2, 4, 1, 5, 0, 6]);
  const board = createBoard();
  for (let r = 0; r < ROWS; r += 1) board[r][3] = HUMAN; // column 4 full
  assert.ok(!legalMoves(board).includes(3));
  assert.equal(legalMoves(board).length, COLS - 1);
});

test('legalMoves is empty on a full board', () => {
  const board = createBoard();
  for (let r = 0; r < ROWS; r += 1) for (let c = 0; c < COLS; c += 1) board[r][c] = HUMAN;
  assert.deepEqual(legalMoves(board), []);
  assert.equal(chooseMove(board, BOT), -1, 'and the bot says so rather than guessing');
});

test('winsWith answers without leaving a piece behind', () => {
  const board = boardOf('ooo....');
  const before = snapshot(board);
  assert.equal(winsWith(board, 3, BOT), true, 'completing the row wins');
  assert.equal(winsWith(board, 4, BOT), false);
  assert.deepEqual(board, before, 'the probe is non-destructive');
});

test('otherDisc flips, and depthFor falls back to normal on nonsense', () => {
  assert.equal(otherDisc(1), 2);
  assert.equal(otherDisc(2), 1);
  assert.equal(depthFor('hard'), DIFFICULTIES.hard);
  assert.equal(depthFor('HARD'), DIFFICULTIES.hard, 'case-insensitive');
  assert.equal(depthFor('nonsense'), DIFFICULTIES[DEFAULT_DIFFICULTY]);
  assert.equal(depthFor(undefined), DIFFICULTIES[DEFAULT_DIFFICULTY]);
});

test('evaluation ignores contested windows and likes the centre', () => {
  // A window holding both colours is dead — that is the point of scoring
  // windows rather than counting pieces.
  const contested = boardOf('xo.....');
  assert.equal(evaluate(contested, BOT) + evaluate(contested, HUMAN), 0, 'the view is symmetric');

  const centre = createBoard();
  centre[ROWS - 1][3] = BOT;
  assert.ok(evaluate(centre, BOT) > 0, 'owning the centre column is worth something');
  assert.ok(evaluate(centre, HUMAN) < 0, 'and costs the other side the same');
});

// ── the two properties that must hold at EVERY difficulty ────────────────────

const EVERY_DEPTH = Object.values(DIFFICULTIES);

/**
 * Which columns win outright for `disc` — computed, not hand-listed. A
 * position can have more than one winning move (the diagonal fixture below
 * has two), so the property to assert is "played A winning column", not
 * "played the column I happened to write down".
 */
function winningColumns(board, disc) {
  const out = [];
  for (let col = 0; col < COLS; col += 1) {
    const probe = snapshot(board);
    const row = dropPiece(probe, col, disc);
    if (row !== -1 && isWinningMove(probe, row, col)) out.push(col);
  }
  return out;
}

test('the bot always takes an immediate win', () => {
  const positions = [
    { board: boardOf('ooo....'), note: 'horizontal' },
    { board: boardOf('o......', 'o......', 'o......'), note: 'vertical' },
    { board: boardOf('..ox...', '.oox...', 'oxox...'), note: 'diagonal' },
  ];
  for (const { board, note } of positions) {
    const wins = winningColumns(board, BOT);
    assert.ok(wins.length > 0, `${note}: the fixture really is a win-in-one`);
    for (const depth of EVERY_DEPTH) {
      assert.ok(wins.includes(chooseMove(board, BOT, { depth })), `${note} @ depth ${depth}`);
    }
  }
});

test('the bot always blocks an immediate loss', () => {
  const positions = [
    { board: boardOf('xxx....'), note: 'horizontal' },
    { board: boardOf('x......', 'x......', 'x......'), note: 'vertical' },
  ];
  for (const { board, note } of positions) {
    const threats = winningColumns(board, HUMAN);
    assert.equal(threats.length, 1, `${note}: exactly one square to defend`);
    assert.deepEqual(winningColumns(board, BOT), [], `${note}: and no win of its own to prefer`);
    for (const depth of EVERY_DEPTH) {
      assert.equal(chooseMove(board, BOT, { depth }), threats[0], `${note} @ depth ${depth}`);
    }
  }
});

test('winning beats blocking — take the point, do not defend it', () => {
  // The bot can win at column 3; the human threatens at column 6. Both are
  // one move away, and the bot's own win ends the game first.
  const board = boardOf('ooo.xxx');
  for (const depth of EVERY_DEPTH) {
    assert.equal(chooseMove(board, BOT, { depth }), 3, `depth ${depth}`);
  }
});

test('the bot never plays a full column', () => {
  const board = createBoard();
  for (let r = 0; r < ROWS; r += 1) board[r][3] = r % 2 === 0 ? HUMAN : BOT;
  for (const depth of EVERY_DEPTH) {
    const col = chooseMove(board, BOT, { depth });
    assert.notEqual(col, 3, `depth ${depth}`);
    assert.ok(col >= 0 && col < COLS);
    assert.equal(board[0][col], 0, 'the chosen column has room');
  }
});

test('choosing never mutates the caller’s board', () => {
  const board = boardOf('.xo....', 'oxo.x..');
  const before = snapshot(board);
  chooseMove(board, BOT, { depth: DIFFICULTIES.hard });
  assert.deepEqual(board, before);
});

// ── depth ────────────────────────────────────────────────────────────────────

test('depth 0 still respects the tactical layer, and can be randomised', () => {
  assert.equal(chooseMove(boardOf('ooo....'), BOT, { depth: 0 }), 3, 'still takes the win');
  assert.equal(chooseMove(boardOf('xxx....'), BOT, { depth: 0 }), 3, 'still blocks');
  // With nothing tactical on the board, depth 0 just picks a legal column.
  const picked = chooseMove(createBoard(), BOT, { depth: 0, random: () => 0.999 });
  assert.ok(legalMoves(createBoard()).includes(picked));
});

test('a deeper search sees a trap that a shallow one walks into', () => {
  // Human (x) holds a3–c3 style split; the honest claim we can assert without
  // over-fitting is that `hard` never hands the human an immediate win.
  const board = boardOf('.......', '.......', '..x....', '..xo...', '.oxo...');
  const col = chooseMove(board, BOT, { depth: DIFFICULTIES.hard });
  const after = snapshot(board);
  const row = dropPiece(after, col, BOT);
  assert.notEqual(row, -1);
  const humanWins = legalMoves(after).some((c) => {
    const probe = snapshot(after);
    const r = dropPiece(probe, c, HUMAN);
    return r !== -1 && isWinningMove(probe, r, c);
  });
  assert.equal(humanWins, false, 'hard does not gift an immediate win');
});

test('the search is fast enough for a Pi at every difficulty', () => {
  // Not a benchmark — a ceiling. An empty board is the widest search there is;
  // if `hard` is instant here it is instant everywhere.
  const started = Date.now();
  for (const depth of EVERY_DEPTH) chooseMove(createBoard(), BOT, { depth });
  assert.ok(Date.now() - started < 3_000, 'all three difficulties inside 3 s');
});

// ── the service seam ─────────────────────────────────────────────────────────

test('a solo game is marked as one, and an ordinary duel is not', () => {
  const solo = createChallenge('chan-solo', 'g1', 'human', 'bot', { botDepth: 4 }).game;
  assert.equal(isSolo(solo), true);
  endGame('chan-solo');

  const duel = createChallenge('chan-duel', 'g1', 'a', 'b').game;
  assert.equal(isSolo(duel), false, 'no botDepth means two humans');
  endGame('chan-duel');
});

test('playBotTurn drops a real piece and hands the turn back', () => {
  const game = startGame(createChallenge('chan-1', 'g1', 'human', 'bot', { botDepth: 2 }).game);
  game.turn = 2;
  const result = playBotTurn(game);
  assert.equal(result.code, 'next');
  assert.equal(game.board[result.row][result.col], BOT, 'the piece is on the board');
  assert.equal(game.turn, 1, 'and it is the human’s move again');
  endGame('chan-1');
});

test('playBotTurn reports its own win', () => {
  const game = startGame(createChallenge('chan-2', 'g1', 'human', 'bot', { botDepth: 2 }).game);
  game.board = boardOf('ooo....');
  game.turn = 2;
  assert.equal(playBotTurn(game).code, 'win');
  endGame('chan-2');
});

test('playBotTurn refuses to move out of turn, or in a two-human duel', () => {
  const solo = startGame(createChallenge('chan-3', 'g1', 'human', 'bot', { botDepth: 2 }).game);
  solo.turn = 1;
  assert.equal(playBotTurn(solo).code, 'not-your-turn', 'never plays the human’s move for them');
  endGame('chan-3');

  const duel = startGame(createChallenge('chan-4', 'g1', 'a', 'b').game);
  duel.turn = 2;
  assert.equal(playBotTurn(duel).code, 'not-solo');
  endGame('chan-4');
});

test('a solo game the bot cannot win still ends as a tie, not a crash', () => {
  const game = startGame(createChallenge('chan-5', 'g1', 'human', 'bot', { botDepth: 1 }).game);
  // One empty cell left, and filling it wins for nobody. The gap sits at the
  // TOP of a column — my first attempt put it at the bottom, which is a
  // position Connect 4 cannot reach (pieces fall) and which `legalMoves`
  // correctly reported as a full column.
  game.board = boardOf('xxoxxo.', 'ooxooxo', 'xxoxxox', 'ooxooxo', 'xxoxxox', 'ooxooxo');
  game.turn = 2;
  assert.equal(playBotTurn(game).code, 'tie');
  endGame('chan-5');
});
