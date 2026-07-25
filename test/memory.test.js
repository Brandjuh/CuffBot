// Memory (S82 = M16.9, AAA3A memorygame port): board layouts, the exact
// decayed-prize formula (Python int() truncation order pinned), the press
// state machine incl. the same-tile-twice cog quirk, the loss path with the
// double-count bug FIXED (games count once), the win settlement + economy
// seam, and the group shape.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import {
  BLANK,
  DEFAULT_MAX_PRIZE,
  GAME_EMOJIS,
  buildTiles,
  computePrize,
  pairCount,
} from '../src/modules/memory/lib/game.js';
import {
  clearAllMemoryGames,
  createMemoryGame,
  endMemoryGame,
  finishWin,
  getMemoryConfig,
  getMemoryStats,
  markStarted,
  pressTile,
  recordGamePlayed,
  resetMemoryStats,
  setMemoryConfig,
  topMemory,
  unlockMemoryGame,
} from '../src/modules/memory/service.js';
import memoryCommand from '../src/modules/memory/commands/memory.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-memory-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
  clearAllMemoryGames();
});

let seq = 0;
const freshGuildId = () => `82000000000000${String((seq += 1)).padStart(4, '0')}`;

const lcg = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** emoji → [tile indexes] for a built board (skipping the blank). */
const pairIndexes = (tiles) => {
  const map = new Map();
  tiles.forEach((emoji, index) => {
    if (emoji === BLANK) return;
    map.set(emoji, [...(map.get(emoji) ?? []), index]);
  });
  return map;
};

// ── pure rules ───────────────────────────────────────────────────────────────

test('buildTiles mirrors the cog layouts: pair counts, sizes, center blanks', () => {
  for (const [difficulty, size, blankAt] of [
    ['3x3', 9, 4],
    ['4x4', 16, null],
    ['5x5', 25, 12],
  ]) {
    const tiles = buildTiles(lcg(7), difficulty);
    assert.equal(tiles.length, size, `${difficulty} board size`);
    const blanks = tiles.filter((t) => t === BLANK);
    if (blankAt === null) {
      assert.equal(blanks.length, 0, '4x4 has no blank');
    } else {
      assert.equal(blanks.length, 1);
      assert.equal(tiles[blankAt], BLANK, `${difficulty} blank sits at the center`);
    }
    const pairs = pairIndexes(tiles);
    assert.equal(pairs.size, pairCount(difficulty), `${difficulty} pair count`);
    for (const [emoji, indexes] of pairs) {
      assert.ok(GAME_EMOJIS.includes(emoji), 'emojis come from the cog pool');
      assert.equal(indexes.length, 2, `${emoji} appears exactly twice`);
    }
  }
});

test('computePrize is the cog formula bit-for-bit (int() truncation order)', () => {
  const base = { maxPrize: 5000, reductionPerSecond: 5, reductionPerWrongMatch: 15 };
  // int(5000/3*2) = 3333 (NOT floor(5000/3)*2 = 3332) — then ·(4/5) → 2666.
  assert.equal(computePrize({ difficulty: '4x4', seconds: 0, wrongMatches: 0, ...base }), 2666);
  // int(5000/3) = 1666 → ·(3/5) = 999.6 → 999.
  assert.equal(computePrize({ difficulty: '3x3', seconds: 0, wrongMatches: 0, ...base }), 999);
  assert.equal(computePrize({ difficulty: '5x5', seconds: 0, wrongMatches: 0, ...base }), 5000);
  assert.equal(computePrize({ difficulty: '5x5', seconds: 60, wrongMatches: 4, ...base }), 4640);
  assert.equal(computePrize({ difficulty: '5x5', seconds: 2000, wrongMatches: 0, ...base }), 0, 'never negative');
});

// ── the press state machine ──────────────────────────────────────────────────

test('pressTile: select/match/mismatch, blank + found ignored, same tile twice is a wrong match', () => {
  const guildId = freshGuildId();
  const game = createMemoryGame('chan', guildId, 'alice', { difficulty: '3x3', random: lcg(11) });
  const pairs = [...pairIndexes(game.tiles).values()];

  assert.equal(pressTile(game, 4).code, 'ignored', 'the center blank never reacts');

  const [a1, a2] = pairs[0];
  assert.equal(pressTile(game, a1).code, 'selected');
  assert.equal(pressTile(game, a1).code, 'mismatch', 'the same tile twice is a WRONG match (cog quirk)');
  assert.equal(game.tries, 1);
  assert.equal(game.wrongMatches, 1);
  assert.equal(game.locked, true, 'the flash lock engages');
  assert.equal(pressTile(game, a2).code, 'busy', 'presses during the flash are ignored');
  unlockMemoryGame(game);

  assert.equal(pressTile(game, a1).code, 'selected');
  const matched = pressTile(game, a2);
  assert.equal(matched.code, 'match');
  assert.deepEqual([matched.first, matched.second], [a1, a2]);
  assert.deepEqual(game.found, [game.tiles[a1]]);
  assert.equal(pressTile(game, a1).code, 'ignored', 'found tiles never react again');

  const [b1] = pairs[1];
  const [c1] = pairs[2];
  assert.equal(pressTile(game, b1).code, 'selected');
  assert.equal(pressTile(game, c1).code, 'mismatch', 'two different emojis are a wrong match');
  assert.equal(game.tries, 3);
  assert.equal(game.wrongMatches, 2);
  unlockMemoryGame(game);
  endMemoryGame(game.id);
});

test('a full 3x3 win: ended flips on the last match, finishWin settles the exact prize', async () => {
  const guildId = freshGuildId();
  let t = 0;
  const game = createMemoryGame('chan', guildId, 'alice', {
    difficulty: '3x3',
    random: lcg(23),
    now: () => t,
  });
  recordGamePlayed(guildId, 'alice'); // the command does this at start
  markStarted(game);
  const pairs = [...pairIndexes(game.tiles).values()];
  for (let i = 0; i < pairs.length; i += 1) {
    const [x, y] = pairs[i];
    if (i === pairs.length - 1) t = 65_000; // the winning press stamps the clock
    assert.equal(pressTile(game, x).code, 'selected');
    const result = pressTile(game, y);
    assert.equal(result.code, i === pairs.length - 1 ? 'won' : 'match');
  }
  assert.equal(game.ended, true, 'won flips ended synchronously (S22 claim rule)');
  assert.equal(game.endedAt, 65_000);

  const settled = await finishWin(game);
  endMemoryGame(game.id);
  assert.equal(settled.seconds, 65);
  assert.equal(settled.tries, 4);
  assert.equal(settled.wrongMatches, 0);
  // 3x3 base int(5000/3)=1666; (1666 − 65·5)·(3/5) = 1341·0.6 = 804.6 → 804.
  assert.equal(settled.prize, 804);
  assert.equal(settled.paid, false, 'economy defaults off');

  const stats = getMemoryStats(guildId);
  assert.deepEqual(stats.players.alice, { score: 804, wins: 1, games: 1 });
  assert.equal(topMemory(guildId)[0].id, 'alice');
});

test('the wrong-match limit loses the game — and games count ONCE (cog double-count bug fixed)', () => {
  const guildId = freshGuildId();
  setMemoryConfig(guildId, { maxWrongMatches: 2 });
  const game = createMemoryGame('chan', guildId, 'bob', { difficulty: '3x3', random: lcg(31) });
  assert.equal(game.maxWrongMatches, 2, 'the limit is snapshotted at creation (cog reads it at command time)');
  recordGamePlayed(guildId, 'bob');
  markStarted(game);
  const pairs = [...pairIndexes(game.tiles).values()];
  const [a1] = pairs[0];
  const [b1] = pairs[1];

  pressTile(game, a1);
  assert.equal(pressTile(game, b1).code, 'mismatch');
  unlockMemoryGame(game);
  pressTile(game, a1);
  const second = pressTile(game, b1);
  assert.equal(second.code, 'lost', 'the limit ends the game');
  assert.equal(game.ended, true);
  assert.equal(pressTile(game, a1).code, 'ended');
  endMemoryGame(game.id);

  const stats = getMemoryStats(guildId);
  assert.deepEqual(
    stats.players.bob,
    { score: 0, wins: 0, games: 1 },
    'the cog incremented games AGAIN in lose() — we count once (recorded deviation)',
  );
});

test('the economy toggle pays the prize in donuts through the seam', async () => {
  const guildId = freshGuildId();
  setMemoryConfig(guildId, { economy: true });
  const { balanceOf } = await import('../src/modules/economy/service.js');
  const before = balanceOf(guildId, 'carol');
  const game = createMemoryGame('chan', guildId, 'carol', { difficulty: '3x3', random: lcg(41), now: () => 0 });
  markStarted(game);
  for (const [x, y] of pairIndexes(game.tiles).values()) {
    pressTile(game, x);
    pressTile(game, y);
  }
  assert.equal(game.ended, true);
  const settled = await finishWin(game);
  endMemoryGame(game.id);
  assert.equal(settled.prize, 999, '3x3, 0 seconds, 0 wrong: int(1666·0.6)');
  assert.equal(settled.paid, true);
  assert.equal(balanceOf(guildId, 'carol'), before + 999, 'donuts actually moved');
});

// ── config + stats plumbing ──────────────────────────────────────────────────

test('config defaults mirror the cog; sparse overrides win', () => {
  const guildId = freshGuildId();
  assert.deepEqual(getMemoryConfig(guildId), {
    maxWrongMatches: 0,
    economy: false,
    maxPrize: DEFAULT_MAX_PRIZE,
    reductionPerSecond: 5,
    reductionPerWrongMatch: 15,
  });
  setMemoryConfig(guildId, { maxPrize: 20_000, reductionPerSecond: 0 });
  const config = getMemoryConfig(guildId);
  assert.equal(config.maxPrize, 20_000);
  assert.equal(config.reductionPerSecond, 0);
  assert.equal(config.reductionPerWrongMatch, 15, 'untouched keys keep their defaults');
});

test('resetMemoryStats wipes the scoreboard', () => {
  const guildId = freshGuildId();
  recordGamePlayed(guildId, 'dave');
  assert.equal(getMemoryStats(guildId).players.dave.games, 1);
  resetMemoryStats(guildId);
  assert.deepEqual(getMemoryStats(guildId).players, {});
});

// ── group wiring ─────────────────────────────────────────────────────────────

test('!memory group shape: public play/leaderboard, admin knobs, play fallback', () => {
  const group = memoryCommand.group;
  assert.equal(group.name, 'memory');
  assert.ok(group.aliases.includes('memorygame'));
  assert.equal(group.permission, undefined, 'the group is public');
  assert.equal(group.fallback, 'play', '`!memory 3x3` reads like the cog invocation');
  assert.deepEqual(
    group.subcommands.map((s) => [s.name, s.permission ?? null]),
    [
      ['play', null],
      ['leaderboard', null],
      ['maxwrong', PermissionFlagsBits.ManageGuild],
      ['maxprize', PermissionFlagsBits.ManageGuild],
      ['decay', PermissionFlagsBits.ManageGuild],
      ['economy', PermissionFlagsBits.ManageGuild],
      ['resetleaderboard', PermissionFlagsBits.ManageGuild],
    ],
  );
  const play = group.subcommands[0];
  assert.deepEqual(play.args[0].choices, ['3x3', '4x4', '5x5']);
  assert.equal(play.args[0].required, false);
});
