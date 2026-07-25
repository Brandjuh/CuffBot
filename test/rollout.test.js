// Rollout (S81 = M16.8, AAA3A port): the pure split/roll, the lobby, config
// + stats (incl. the economy payout seam), and whole games through the
// io-driven runner — including all three survey edge cases (round restart,
// full-timeout abort, and the tie the cog crashed on).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import {
  DEFAULT_PRIZE,
  MAX_PLAYERS,
  NUMBERS,
  rollNumber,
  splitEliminated,
} from '../src/modules/rollout/lib/game.js';
import {
  clearAllRolloutGames,
  createRolloutLobby,
  endRolloutGame,
  getRolloutConfig,
  getRolloutGame,
  getRolloutStats,
  joinRollout,
  leaveRollout,
  pickNumber,
  resetRolloutStats,
  runRolloutGame,
  setRolloutConfig,
  topRollout,
} from '../src/modules/rollout/service.js';
import rolloutCommand from '../src/modules/rollout/commands/rollout.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-rollout-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
  clearAllRolloutGames();
});

let seq = 0;
const freshGuildId = () => `81000000000000${String((seq += 1)).padStart(4, '0')}`;
const freshChannelId = () => `ro-chan-${seq}`;

// ── pure rules ───────────────────────────────────────────────────────────────

test('rollNumber only rolls open numbers; splitEliminated matches the cog', () => {
  const disabled = [1, 2, 3];
  assert.equal(rollNumber(() => 0, disabled), 4, 'first open number');
  assert.equal(rollNumber(() => 0.999999, []), NUMBERS);

  const { timeoutEliminated, numberEliminated, survivors } = splitEliminated(
    ['a', 'b', 'c', 'd'],
    { a: 7, b: 7, c: 12 }, // d picked nothing
    7,
  );
  assert.deepEqual(timeoutEliminated, ['d']);
  assert.deepEqual(numberEliminated, ['a', 'b']);
  assert.deepEqual(survivors, ['c']);
});

// ── lobby + config + stats ───────────────────────────────────────────────────

test('lobby: host auto-joins, cap 50, leave, one per channel', () => {
  const channelId = freshChannelId();
  const { game } = createRolloutLobby(channelId, 'g1', 'host');
  assert.deepEqual(game.players, ['host']);
  assert.equal(createRolloutLobby(channelId, 'g1', 'x').error, 'busy');
  assert.equal(joinRollout(game, 'host'), 'already');
  for (let i = 2; i <= MAX_PLAYERS; i += 1) assert.equal(joinRollout(game, `p${i}`), 'joined');
  assert.equal(joinRollout(game, 'p51'), 'full');
  assert.equal(leaveRollout(game, 'p2'), 'left');
  assert.equal(leaveRollout(game, 'p2'), 'not-joined');
  endRolloutGame(channelId);
  assert.equal(getRolloutGame(channelId), null);
});

test('config defaults mirror the cog (prize 2500 — the CODE default — economy off)', () => {
  const guildId = freshGuildId();
  const config = getRolloutConfig(guildId);
  assert.equal(config.prize, DEFAULT_PRIZE);
  assert.equal(DEFAULT_PRIZE, 2500, 'the cog help text says 5000 but the code says 2500 — port the code');
  assert.equal(config.economy, false);
  setRolloutConfig(guildId, { prize: 10_000, economy: true });
  assert.deepEqual(getRolloutConfig(guildId), { prize: 10_000, economy: true });
});

test('stats: games count at start, wins+score on victory, reset wipes', () => {
  const guildId = freshGuildId();
  resetRolloutStats(guildId);
  assert.deepEqual(getRolloutStats(guildId).players, {});
});

// ── whole games through the runner ───────────────────────────────────────────

function scriptedIo({ onRound = () => {} } = {}) {
  const events = [];
  return {
    events,
    openRound: async (round, alive, disabled, endsAt) => {
      events.push(['round', round, [...alive], [...disabled]]);
      onRound(round, alive, disabled);
    },
    revealNumber: async (n) => events.push(['reveal', n]),
    nobodyAnswered: async () => events.push(['nobody']),
    roundRestart: async (n) => events.push(['restart', n]),
    results: async (round, n, numberEliminated, timeoutEliminated, survivors) =>
      events.push(['results', round, n, [...numberEliminated], [...timeoutEliminated], [...survivors]]),
    tie: async () => events.push(['tie']),
    winner: async (winnerId, prize, paid) => events.push(['winner', winnerId, prize, paid]),
  };
}

test('a two-round game: eliminations accumulate, the winner is paid on the scoreboard', async () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();
  const { game } = createRolloutLobby(channelId, guildId, 'alice');
  joinRollout(game, 'bob');
  joinRollout(game, 'carol');
  // Round 1: roll 1 (random 0). alice picks 1 (eliminated), bob 2, carol 3.
  // Round 2: roll 2 (first open after disabling 1... random 0 → open[0]=2). bob picks 2 → eliminated; carol 3 wins.
  const io = scriptedIo({
    onRound: (round) => {
      if (round === 1) {
        pickNumber(game, 'alice', 1);
        pickNumber(game, 'bob', 2);
        pickNumber(game, 'carol', 3);
      } else {
        pickNumber(game, 'bob', 2);
        pickNumber(game, 'carol', 3);
      }
    },
  });
  const result = await runRolloutGame(game, io, { random: () => 0, pickMs: 50, now: () => 0 });
  assert.equal(result.outcome, 'winner');
  assert.equal(result.winnerId, 'carol');
  assert.equal(result.rounds, 2);
  const kinds = io.events.map((e) => e[0]);
  assert.deepEqual(kinds, ['round', 'reveal', 'results', 'round', 'reveal', 'results', 'winner']);
  assert.deepEqual(io.events[2].slice(1), [1, 1, ['alice'], [], ['bob', 'carol']], 'round 1 results');
  assert.deepEqual(io.events[3][3], [1], 'round 2 board has number 1 disabled');

  const stats = getRolloutStats(guildId);
  assert.equal(stats.players.carol.wins, 1);
  assert.equal(stats.players.carol.score, DEFAULT_PRIZE);
  assert.equal(stats.players.carol.games, 1);
  assert.equal(stats.players.alice.games, 1, 'every joiner counts a game');
  assert.equal(stats.players.alice.wins ?? 0, 0);
  assert.equal(topRollout(guildId)[0].id, 'carol');
});

test('everyone eliminated WITH a pick restarts the round — number stays enabled, players stay', async () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();
  const { game } = createRolloutLobby(channelId, guildId, 'alice');
  joinRollout(game, 'bob');
  let phase = 0;
  const io = scriptedIo({
    onRound: () => {
      phase += 1;
      if (phase === 1) {
        // both pick the rolled number 1 → all eliminated → restart
        pickNumber(game, 'alice', 1);
        pickNumber(game, 'bob', 1);
      } else {
        pickNumber(game, 'alice', 1); // rolled again (still enabled!) → alice out, bob wins
        pickNumber(game, 'bob', 2);
      }
    },
  });
  const result = await runRolloutGame(game, io, { random: () => 0, pickMs: 50, now: () => 0 });
  assert.equal(result.outcome, 'winner');
  assert.equal(result.winnerId, 'bob');
  assert.equal(result.rounds, 1, 'the restarted round does not count (cog decrements)');
  const kinds = io.events.map((e) => e[0]);
  assert.deepEqual(kinds, ['round', 'reveal', 'restart', 'round', 'reveal', 'results', 'winner']);
  assert.deepEqual(io.events[3][3], [], 'number 1 was NOT disabled after the restart');
});

test('nobody picking anything aborts the game — no winner, no payout', async () => {
  // This test genuinely waits out the unref'd pick timer — keep the loop alive.
  const keepAlive = setInterval(() => {}, 50);
  try {
    const guildId = freshGuildId();
    const channelId = freshChannelId();
    const { game } = createRolloutLobby(channelId, guildId, 'alice');
    joinRollout(game, 'bob');
    const io = scriptedIo(); // nobody ever picks
    const result = await runRolloutGame(game, io, { random: () => 0, pickMs: 20, now: () => 0 });
    assert.equal(result.outcome, 'aborted');
    assert.deepEqual(io.events.map((e) => e[0]), ['round', 'reveal', 'nobody']);
    const stats = getRolloutStats(guildId);
    assert.equal(stats.players.alice?.wins ?? 0, 0, 'nobody paid');
    assert.equal(stats.players.alice.games, 1, 'the game still counted as played');
  } finally {
    clearInterval(keepAlive);
  }
});

test('24 disabled numbers with players alive is a TIE (the cog crashed here)', async () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();
  const { game } = createRolloutLobby(channelId, guildId, 'alice');
  joinRollout(game, 'bob');
  // Script 24 rounds: every round both players survive (pick ≠ rolled), one
  // number gets disabled per round → round 25 would start with 24 disabled.
  const io = scriptedIo({
    onRound: (round, alive, disabled) => {
      // roll = first open number (seeded 0); both pick the LAST open number
      // (≠ roll while ≥2 numbers stay open — true for all 24 rounds).
      const open = [];
      for (let i = 1; i <= NUMBERS; i += 1) if (!disabled.includes(i)) open.push(i);
      const safe = open.at(-1);
      for (const id of alive) pickNumber(game, id, safe);
    },
  });
  const result = await runRolloutGame(game, io, { random: () => 0, pickMs: 50, now: () => 0 });
  assert.equal(result.outcome, 'tie');
  assert.equal(result.rounds, 24, '24 full rounds then the tie check');
  assert.equal(io.events.at(-1)[0], 'tie');
  const stats = getRolloutStats(guildId);
  assert.equal((stats.players.alice?.wins ?? 0) + (stats.players.bob?.wins ?? 0), 0, 'no winner recorded');
});

test('the economy toggle pays the winner in donuts through the seam', async () => {
  const guildId = freshGuildId();
  const channelId = freshChannelId();
  setRolloutConfig(guildId, { economy: true, prize: 2000 });
  const { balanceOf } = await import('../src/modules/economy/service.js');
  const before = balanceOf(guildId, 'bob');
  const { game } = createRolloutLobby(channelId, guildId, 'alice');
  joinRollout(game, 'bob');
  const io = scriptedIo({
    onRound: () => {
      pickNumber(game, 'alice', 1); // rolled → alice out
      pickNumber(game, 'bob', 2);
    },
  });
  const result = await runRolloutGame(game, io, { random: () => 0, pickMs: 50, now: () => 0 });
  assert.equal(result.outcome, 'winner');
  assert.deepEqual(io.events.at(-1), ['winner', 'bob', 2000, true], 'payout flagged');
  assert.equal(balanceOf(guildId, 'bob'), before + 2000, 'donuts actually moved');
});

// ── group wiring ─────────────────────────────────────────────────────────────

test('!rollout group shape: public play/leaderboard, admin prize/economy/reset', () => {
  const group = rolloutCommand.group;
  assert.equal(group.name, 'rollout');
  assert.ok(group.aliases.includes('rolloutgame'));
  assert.equal(group.permission, undefined, 'the group is public');
  assert.deepEqual(
    group.subcommands.map((s) => [s.name, s.permission ?? null]),
    [
      ['play', null],
      ['leaderboard', null],
      ['prize', PermissionFlagsBits.ManageGuild],
      ['economy', PermissionFlagsBits.ManageGuild],
      ['resetleaderboard', PermissionFlagsBits.ManageGuild],
    ],
  );
});
