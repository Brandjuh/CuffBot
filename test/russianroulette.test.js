// Russian roulette (S73 = M16.5, AAA3A port): pure draws, the lobby, the
// shot bridge, and the round runner driven by a scripted io + seeded random —
// including the two upstream bugs this port fixes.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import {
  MAX_PLAYERS,
  MISFIRE_CHANCE,
  pickMisfireVictim,
  rollBullet,
  rollSelfDeath,
  shufflePlayers,
} from '../src/modules/russianroulette/lib/game.js';
import {
  awaitShot,
  clearAllRouletteGames,
  createLobby,
  endRouletteGame,
  getRouletteGame,
  joinLobby,
  leaveLobby,
  resolveShot,
  runGame,
} from '../src/modules/russianroulette/service.js';
import rouletteCommand from '../src/modules/russianroulette/commands/russianroulette.js';

after(() => clearAllRouletteGames());

let seq = 0;
const freshChannelId = () => `rr-chan-${(seq += 1)}`;

/** random() that pops scripted values (fails loudly when the script runs dry). */
const scriptedRandom = (values) => () => {
  assert.ok(values.length > 0, 'random script exhausted');
  return values.shift();
};

// ── pure draws ───────────────────────────────────────────────────────────────

test('shuffle is a seeded Fisher–Yates on a copy; bullet and victim draws bound-check', () => {
  const players = ['a', 'b', 'c', 'd'];
  const shuffled = shufflePlayers(scriptedRandom([0, 0, 0]), players);
  assert.deepEqual(players, ['a', 'b', 'c', 'd'], 'input untouched');
  assert.deepEqual([...shuffled].sort(), ['a', 'b', 'c', 'd'], 'same members');
  assert.deepEqual(shufflePlayers(() => 0.999999, players), players, 'identity shuffle possible');

  assert.equal(rollBullet(() => 0, 5), 0);
  assert.equal(rollBullet(() => 0.999999, 5), 4);
  assert.equal(rollSelfDeath(() => MISFIRE_CHANCE), true, '0.1 itself is a self-death (cog: >= 0.1)');
  assert.equal(rollSelfDeath(() => 0.05), false, 'below 0.1 misfires');
  assert.equal(pickMisfireVictim(() => 0, ['a', 'b', 'c'], 'b'), 'a', 'shooter excluded');
});

// ── lobby ────────────────────────────────────────────────────────────────────

test('lobby: host auto-joins, dupes/full refused, leave works, one per channel', () => {
  const channelId = freshChannelId();
  const { game } = createLobby(channelId, 'g1', 'host');
  assert.deepEqual(game.players, ['host'], 'host auto-joined (cog behavior)');
  assert.equal(createLobby(channelId, 'g1', 'other').error, 'busy');

  assert.equal(joinLobby(game, 'host'), 'already');
  assert.equal(joinLobby(game, 'p2'), 'joined');
  for (let i = 3; i <= MAX_PLAYERS; i += 1) assert.equal(joinLobby(game, `p${i}`), 'joined');
  assert.equal(joinLobby(game, 'p31'), 'full');
  assert.equal(leaveLobby(game, 'p2'), 'left');
  assert.equal(leaveLobby(game, 'p2'), 'not-joined');
  endRouletteGame(channelId);
  assert.equal(getRouletteGame(channelId), null);
});

// ── the shot bridge ──────────────────────────────────────────────────────────

test('awaitShot resolves on the right player’s press, times out otherwise', async () => {
  // The shot timer is unref'd (production must not block shutdown) — keep the
  // event loop alive while this test genuinely waits on it.
  const keepAlive = setInterval(() => {}, 100);
  try {
    const channelId = freshChannelId();
    const { game } = createLobby(channelId, 'g1', 'host');
    const pending = awaitShot(game, 'host', 50);
    assert.equal(resolveShot(game, 'stranger'), false, 'wrong presser rejected');
    assert.equal(resolveShot(game, 'host'), true);
    assert.equal(await pending, 'shot');

    const timing = awaitShot(game, 'host', 10);
    assert.equal(await timing, 'timeout');
    endRouletteGame(channelId);
  } finally {
    clearInterval(keepAlive);
  }
});

// ── the round runner (scripted io) ───────────────────────────────────────────

function scriptedIo(shots) {
  const events = [];
  return {
    events,
    say: async (event) => events.push(event),
    askShot: async (playerId) => {
      assert.ok(shots.length > 0, 'shot script exhausted');
      const next = shots.shift();
      assert.equal(playerId, next.player, `turn order: expected ${next.player}`);
      return next.outcome;
    },
    sleep: async () => {},
  };
}

test('a clean two-player game: click, then the chambered shot kills — winner announced', async () => {
  const channelId = freshChannelId();
  const { game } = createLobby(channelId, 'g1', 'alice');
  joinLobby(game, 'bob');
  // Round 1: bullet index 1, identity shuffle (alice, bob): alice clicks, bob dies.
  const random = scriptedRandom([
    0.6, // bullet = floor(0.6*2) = 1
    0.999999, // shuffle keeps order
    0.5, // self-death roll (>= 0.1 → dead)
  ]);
  const io = scriptedIo([
    { player: 'alice', outcome: 'shot' },
    { player: 'bob', outcome: 'shot' },
  ]);
  const result = await runGame(game, io, { random, dramaMs: 0 });
  assert.equal(result.winnerId, 'alice');
  assert.equal(result.rounds, 1);
  const kinds = io.events.map((e) => e.kind);
  assert.deepEqual(kinds, ['round', 'trigger', 'click', 'trigger', 'dead', 'winner']);
  assert.equal(io.events.at(-2).playerId, 'bob');
  assert.equal(getRouletteGame(channelId), null, 'runner cleans up');
});

test('a misfire kills a random OTHER player and ends the round', async () => {
  const channelId = freshChannelId();
  const { game } = createLobby(channelId, 'g1', 'alice');
  joinLobby(game, 'bob');
  joinLobby(game, 'carol');
  // Round 1: bullet 0, identity shuffle; alice at the chamber misfires into carol.
  // Round 2 (alice, bob): bullet 0, alice self-dies → bob wins.
  const random = scriptedRandom([
    0, // bullet round 1 = 0
    0.999999, 0.999999, // shuffle (3 players → 2 draws) identity
    0.05, // misfire (< 0.1)
    0.6, // victim among [bob, carol] → floor(0.6*2)=1 → carol
    0, // bullet round 2 = 0
    0.999999, // shuffle (2 players)
    0.5, // self-death
  ]);
  const io = scriptedIo([
    { player: 'alice', outcome: 'shot' }, // round 1 chamber
    { player: 'alice', outcome: 'shot' }, // round 2
  ]);
  const result = await runGame(game, io, { random, dramaMs: 0 });
  assert.equal(result.winnerId, 'bob');
  const kinds = io.events.map((e) => e.kind);
  assert.deepEqual(kinds, ['round', 'trigger', 'misfire', 'round', 'trigger', 'dead', 'winner']);
  const misfire = io.events[2];
  assert.equal(misfire.playerId, 'alice');
  assert.equal(misfire.victimId, 'carol', 'the wrong-direction shot hit carol');
});

test('an AFK player is shot by the bot and the round CONTINUES to the next player (upstream skip bug fixed)', async () => {
  const channelId = freshChannelId();
  const { game } = createLobby(channelId, 'g1', 'alice');
  joinLobby(game, 'bob');
  joinLobby(game, 'carol');
  // bullet 2, identity order [alice, bob, carol]; alice AFK-dies; bob and
  // carol still get their turns (the cog would have SKIPPED bob); carol sits
  // at the chamber and self-dies → bob wins... wait: alive after alice = 2,
  // round continues; carol at i=2 == bullet → dead. bob wins in round 1.
  const random = scriptedRandom([
    0.999999, // bullet = floor(r*3) = 2
    0.999999, 0.999999, // identity shuffle
    0.5, // carol's self-death roll
  ]);
  const io = scriptedIo([
    { player: 'alice', outcome: 'timeout' },
    { player: 'bob', outcome: 'shot' }, // the cog's bug would never ask bob
    { player: 'carol', outcome: 'shot' },
  ]);
  const result = await runGame(game, io, { random, dramaMs: 0 });
  assert.equal(result.winnerId, 'bob');
  const kinds = io.events.map((e) => e.kind);
  assert.deepEqual(kinds, ['round', 'afk', 'trigger', 'click', 'trigger', 'dead', 'winner']);
});

test('the last survivor wins WITHOUT facing their turn (upstream everyone-AFK crash fixed)', async () => {
  // The cog kept asking the sole survivor to shoot — they could die too,
  // leaving zero players and an IndexError on the winner lookup. Here the
  // round stops the moment one player remains: you win by outliving the rest.
  const channelId = freshChannelId();
  const { game } = createLobby(channelId, 'g1', 'alice');
  joinLobby(game, 'bob');
  const random = scriptedRandom([0, 0.999999]); // bullet 0, identity shuffle
  const io = scriptedIo([
    { player: 'alice', outcome: 'timeout' },
    // bob is deliberately scripted but must NEVER be asked:
    { player: 'bob', outcome: 'timeout' },
  ]);
  const result = await runGame(game, io, { random, dramaMs: 0 });
  assert.equal(result.winnerId, 'bob');
  assert.deepEqual(io.events.map((e) => e.kind), ['round', 'afk', 'winner']);
  assert.equal(io.events.at(-1).playerId, 'bob');
});

test('an AFK death ON the chamber consumes the bullet — no BANG that round', async () => {
  const channelId = freshChannelId();
  const { game } = createLobby(channelId, 'g1', 'alice');
  joinLobby(game, 'bob');
  joinLobby(game, 'carol');
  // Round 1: bullet 0; alice (chamber) AFK-dies; bob and carol click through.
  // Round 2: bullet 0; bob self-dies → carol wins.
  const random = scriptedRandom([
    0, // bullet round 1
    0.999999, 0.999999, // identity shuffle
    0, // bullet round 2
    0.999999, // shuffle 2 players
    0.5, // bob self-death
  ]);
  const io = scriptedIo([
    { player: 'alice', outcome: 'timeout' },
    { player: 'bob', outcome: 'shot' },
    { player: 'carol', outcome: 'shot' },
    { player: 'bob', outcome: 'shot' },
  ]);
  const result = await runGame(game, io, { random, dramaMs: 0 });
  assert.equal(result.winnerId, 'carol');
  const kinds = io.events.map((e) => e.kind);
  assert.deepEqual(kinds, ['round', 'afk', 'trigger', 'click', 'trigger', 'click', 'round', 'trigger', 'dead', 'winner']);
});

// ── group wiring ─────────────────────────────────────────────────────────────

test('!russianroulette group: mod-gated play, rr alias, busy refusal', async () => {
  const group = rouletteCommand.group;
  assert.equal(group.name, 'russianroulette');
  assert.ok(group.aliases.includes('rr'));
  assert.equal(group.permission, undefined, 'the overview is public');
  const play = group.subcommands.find((s) => s.name === 'play');
  assert.equal(play.permission, PermissionFlagsBits.ManageMessages, 'the cog’s mod gate, per-sub');

  const channelId = freshChannelId();
  const replies = [];
  const ctx = {
    prefix: '!',
    guild: { id: 'g1' },
    channel: { id: channelId },
    user: { id: 'mod-1' },
    reply: async (p) => (replies.push(typeof p === 'string' ? { content: p } : p), { edit: async () => {} }),
  };
  await play.run(ctx);
  assert.ok(replies[0].embeds, 'lobby embed posted');
  assert.equal(replies[0].components.length, 1, 'join/leave/players/start/cancel row');
  assert.equal(getRouletteGame(channelId).players[0], 'mod-1', 'host auto-joined');

  await play.run(ctx);
  assert.match(replies[1].content, /one at a time/);
  endRouletteGame(channelId);
});
