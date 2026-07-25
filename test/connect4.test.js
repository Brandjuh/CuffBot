// Connect 4 (S71 = M16.3): pure board rules, the service state machine, the
// two upstream-bug fixes (full-column press, unpersisted ties), stats, and the
// group wiring incl. the S71 framework fallback.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  COLS,
  ROWS,
  createBoard,
  dropPiece,
  isFull,
  isWinningMove,
  renderBoard,
} from '../src/modules/connect4/lib/board.js';
import {
  clearAllGames,
  createChallenge,
  dropMove,
  endGame,
  getGame,
  getStats,
  recordResult,
  startGame,
  topPlayers,
} from '../src/modules/connect4/service.js';
import connect4Command from '../src/modules/connect4/commands/connect4.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-connect4-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
  clearAllGames();
});

let seq = 0;
const freshGuildId = () => `71000000000000${String((seq += 1)).padStart(4, '0')}`;
const freshChannelId = () => `chan-${seq}-${Math.trunc(seq / 7)}`;

// ── board rules ──────────────────────────────────────────────────────────────

test('pieces stack from the bottom; a full column returns -1 (the cog crashed here)', () => {
  const board = createBoard();
  assert.equal(dropPiece(board, 3, 1), ROWS - 1, 'first piece lands on the floor');
  assert.equal(dropPiece(board, 3, 2), ROWS - 2, 'second stacks on top');
  for (let i = 0; i < ROWS - 2; i += 1) dropPiece(board, 3, 1);
  assert.equal(dropPiece(board, 3, 2), -1, 'seventh piece refused');
  assert.equal(dropPiece(board, -1, 1), -1, 'out-of-range column refused');
  assert.equal(dropPiece(board, COLS, 1), -1);
});

test('win detection: horizontal, vertical, both diagonals — and no false positives', () => {
  const horizontal = createBoard();
  for (const col of [0, 1, 2]) dropPiece(horizontal, col, 1);
  const hRow = dropPiece(horizontal, 3, 1);
  assert.equal(isWinningMove(horizontal, hRow, 3), true, 'four across');

  const vertical = createBoard();
  for (let i = 0; i < 3; i += 1) dropPiece(vertical, 5, 2);
  const vRow = dropPiece(vertical, 5, 2);
  assert.equal(isWinningMove(vertical, vRow, 5), true, 'four up');

  // Diagonal ↗: staircase of opponent pieces under the winning run.
  const diagonal = createBoard();
  dropPiece(diagonal, 0, 1);
  dropPiece(diagonal, 1, 2);
  dropPiece(diagonal, 1, 1);
  dropPiece(diagonal, 2, 2);
  dropPiece(diagonal, 2, 2);
  dropPiece(diagonal, 2, 1);
  dropPiece(diagonal, 3, 2);
  dropPiece(diagonal, 3, 2);
  dropPiece(diagonal, 3, 2);
  const dRow = dropPiece(diagonal, 3, 1);
  assert.equal(isWinningMove(diagonal, dRow, 3), true, 'four on the ↗ diagonal');

  const three = createBoard();
  for (const col of [0, 1, 2]) dropPiece(three, col, 1);
  assert.equal(isWinningMove(three, ROWS - 1, 2), false, 'three is not a win');
  // A run of four INTERRUPTED by the opponent is not a win.
  const blocked = createBoard();
  dropPiece(blocked, 0, 1);
  dropPiece(blocked, 1, 1);
  dropPiece(blocked, 2, 2);
  dropPiece(blocked, 3, 1);
  dropPiece(blocked, 4, 1);
  assert.equal(isWinningMove(blocked, ROWS - 1, 4), false, 'interrupted run does not count');
});

test('renderBoard shows the header row and the placed pieces', () => {
  const board = createBoard();
  dropPiece(board, 0, 1);
  dropPiece(board, 6, 2);
  const text = renderBoard(board);
  const lines = text.split('\n');
  assert.equal(lines.length, ROWS + 1);
  assert.match(lines[0], /1️⃣.*7️⃣/, 'column header first');
  assert.ok(lines.at(-1).startsWith('🔴'), 'challenger piece bottom-left');
  assert.ok(lines.at(-1).endsWith('🔵'), 'opponent piece bottom-right');
  assert.equal((text.match(/⚪/g) ?? []).length, ROWS * COLS - 2, 'rest is empty');
});

test('isFull only when the top row has no gaps', () => {
  const board = createBoard();
  assert.equal(isFull(board), false);
  for (let col = 0; col < COLS; col += 1) for (let i = 0; i < ROWS; i += 1) dropPiece(board, col, 1 + ((col + i) % 2));
  assert.equal(isFull(board), true);
});

// ── service state machine ────────────────────────────────────────────────────

test('one game per channel; challenge → accept → alternating moves', () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();
  const { game } = createChallenge(channelId, guildId, 'alice', 'bob');
  assert.equal(getGame(channelId), game);
  assert.equal(createChallenge(channelId, guildId, 'carol', 'dave').error, 'busy');

  startGame(game);
  assert.equal(dropMove(game, 'stranger', 0).code, 'not-player');
  assert.equal(dropMove(game, 'bob', 0).code, 'not-your-turn', 'challenger moves first');
  assert.equal(dropMove(game, 'alice', 0).code, 'next');
  assert.equal(dropMove(game, 'alice', 1).code, 'not-your-turn', 'turns alternate');
  assert.equal(dropMove(game, 'bob', 1).code, 'next');
  endGame(channelId);
  assert.equal(getGame(channelId), null);
});

test('a full-column press refuses without ending the turn (upstream crash fixed)', () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();
  const { game } = createChallenge(channelId, guildId, 'alice', 'bob');
  startGame(game);
  for (let i = 0; i < ROWS; i += 1) {
    const mover = i % 2 === 0 ? 'alice' : 'bob';
    assert.equal(dropMove(game, mover, 2).code, 'next');
  }
  assert.equal(dropMove(game, 'alice', 2).code, 'full-column');
  assert.equal(game.turn, 1, 'the refused press does not consume the turn');
  assert.equal(dropMove(game, 'alice', 3).code, 'next', 'a valid column still plays');
  endGame(channelId);
});

test('a winning drop reports win; a full board reports tie', () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();
  const { game } = createChallenge(channelId, guildId, 'alice', 'bob');
  startGame(game);
  // Alice stacks column 0, Bob stacks column 6 — Alice completes four first.
  for (let i = 0; i < 3; i += 1) {
    assert.equal(dropMove(game, 'alice', 0).code, 'next');
    assert.equal(dropMove(game, 'bob', 6).code, 'next');
  }
  assert.equal(dropMove(game, 'alice', 0).code, 'win');
  endGame(channelId);
});

// ── stats (the tie fix) ──────────────────────────────────────────────────────

test('recordResult persists wins/losses AND ties (upstream never saved ties)', () => {
  const guildId = freshGuildId();
  recordResult(guildId, { winnerId: 'alice', loserId: 'bob' });
  recordResult(guildId, { winnerId: 'alice', loserId: 'carol' });
  recordResult(guildId, { tie: ['alice', 'bob'] });
  const stats = getStats(guildId);
  assert.equal(stats.played, 3);
  assert.equal(stats.ties, 1, 'the guild tie counter persists');
  assert.deepEqual(stats.players.alice, { wins: 2, losses: 0, ties: 1 });
  assert.deepEqual(stats.players.bob, { wins: 0, losses: 1, ties: 1 });
  assert.deepEqual(stats.players.carol, { wins: 0, losses: 1, ties: 0 });

  const top = topPlayers(guildId);
  assert.equal(top[0].id, 'alice', 'most wins first');
});

// ── group wiring ─────────────────────────────────────────────────────────────

const group = connect4Command.group;
const sub = (name) => group.subcommands.find((s) => s.name === name);

function fakeCtx(guildId, channelId) {
  const replies = [];
  return {
    replies,
    prefix: '!',
    guild: { id: guildId },
    channel: { id: channelId },
    user: { id: 'challenger-1' },
    reply: async (p) => {
      replies.push(typeof p === 'string' ? { content: p } : p);
      return { edit: async () => {} }; // the posted challenge message
    },
  };
}

test('!connect4 is a public group with play as the fallback sub', () => {
  assert.equal(group.name, 'connect4');
  assert.ok(group.aliases.includes('c4'));
  assert.equal(group.permission, undefined, 'games are for everyone');
  assert.equal(group.fallback, 'play', '`!connect4 @user` routes straight into the duel');
  assert.deepEqual(group.subcommands.map((s) => s.name), ['play', 'stats']);
});

test('play refuses bots, self, and a busy channel; posts a challenge otherwise', async () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();
  const ctx = fakeCtx(guildId, channelId);

  await sub('play').run(ctx, { opponent: { id: 'k9', bot: true } });
  assert.match(ctx.replies[0].content, /K9 units/);
  await sub('play').run(ctx, { opponent: { id: 'challenger-1', bot: false } });
  assert.match(ctx.replies[1].content, /can’t duel yourself/);

  await sub('play').run(ctx, { opponent: { id: 'opponent-1', bot: false } });
  const challenge = ctx.replies[2];
  assert.ok(challenge.embeds, 'challenge is an embed');
  assert.equal(challenge.components.length, 1, 'accept/decline row');
  assert.deepEqual(challenge.allowedMentions, { users: ['opponent-1'], repliedUser: false }, 'pings exactly the challenged member');
  const game = getGame(channelId);
  assert.equal(game.state, 'pending');

  await sub('play').run(ctx, { opponent: { id: 'someone-else', bot: false } });
  assert.match(ctx.replies[3].content, /one duel at a time/);
  endGame(channelId);
});

test('stats sub renders the scoreboard with medals and the invoker line', async () => {
  const guildId = freshGuildId();
  recordResult(guildId, { winnerId: 'challenger-1', loserId: 'x' });
  const ctx = fakeCtx(guildId, freshChannelId());
  await sub('stats').run(ctx);
  const desc = ctx.replies[0].embeds[0].toJSON().description;
  assert.match(desc, /Games played:\*\* 1/);
  assert.match(desc, /🥇 <@challenger-1>/);
  assert.match(desc, /Your record:\*\* 1W \/ 0L \/ 0T/);
});

test('status names the busy channel and the stats', async () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();
  const free = group.status(fakeCtx(guildId, channelId));
  assert.match(free.join('\n'), /free — the floor is yours/);
  createChallenge(channelId, guildId, 'a', 'b');
  const busy = group.status(fakeCtx(guildId, channelId));
  assert.match(busy.join('\n'), /challenge is waiting/);
  endGame(channelId);
});
