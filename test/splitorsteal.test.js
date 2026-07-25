// Split or Steal (S79 = M16.6, AAA3A port): the pure matrix and draw, the
// lobby/choice state machine, and whole matches through the io-driven runner.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JOIN_WINDOW_MS, pickTwoPlayers, resolveSos } from '../src/modules/splitorsteal/lib/game.js';
import {
  chooseSos,
  clearAllSosGames,
  createSosGame,
  getSosGame,
  joinSos,
  runSosGame,
} from '../src/modules/splitorsteal/service.js';
import sosCommand from '../src/modules/splitorsteal/commands/splitorsteal.js';

after(() => clearAllSosGames());

let seq = 0;
const freshChannelId = () => `sos-chan-${(seq += 1)}`;

// ── pure rules ───────────────────────────────────────────────────────────────

test('resolveSos covers the classic matrix', () => {
  assert.equal(resolveSos('split', 'split'), 'both-win');
  assert.equal(resolveSos('steal', 'steal'), 'both-lose');
  assert.equal(resolveSos('steal', 'split'), 'a-steals');
  assert.equal(resolveSos('split', 'steal'), 'b-steals');
});

test('pickTwoPlayers draws like the cog (choice, remove, choice) without touching input', () => {
  const joiners = ['a', 'b', 'c', 'd'];
  const [first, second] = pickTwoPlayers(() => 0, joiners);
  assert.equal(first, 'a');
  assert.equal(second, 'b', 'second draw comes from the remaining pool');
  assert.deepEqual(joiners, ['a', 'b', 'c', 'd'], 'input untouched');
  const [x, y] = pickTwoPlayers(() => 0.999999, joiners);
  assert.equal(x, 'd');
  assert.equal(y, 'c');
});

// ── state machine ────────────────────────────────────────────────────────────

test('joins only during the join phase; one game per channel; dupes refused', () => {
  const channelId = freshChannelId();
  const { game } = createSosGame(channelId, 'g1');
  assert.equal(createSosGame(channelId, 'g1').error, 'busy');
  assert.equal(joinSos(game, 'a'), 'joined');
  assert.equal(joinSos(game, 'a'), 'already');
  game.state = 'choose';
  assert.equal(joinSos(game, 'b'), 'closed');
  clearAllSosGames();
});

test('choices: contestants only, once each, secret original echoed on repeat', () => {
  const channelId = freshChannelId();
  const { game } = createSosGame(channelId, 'g1');
  game.state = 'choose';
  game.players = ['a', 'b'];
  assert.equal(chooseSos(game, 'stranger', 'split').code, 'not-player');
  assert.equal(chooseSos(game, 'a', 'split').code, 'recorded');
  const repeat = chooseSos(game, 'a', 'steal');
  assert.equal(repeat.code, 'already');
  assert.equal(repeat.original, 'split', 'the first choice is echoed back');
  clearAllSosGames();
});

// ── whole matches through the runner (scripted io, zero real waiting) ────────

function scriptedIo({ onLobby = () => {}, onChoices = () => {} } = {}) {
  const events = [];
  return {
    events,
    openLobby: async (endsAt) => {
      events.push(['lobby', endsAt]);
      onLobby();
    },
    sleep: async () => {}, // the join window elapses instantly in tests
    notEnough: async () => events.push(['not-enough']),
    showChoices: async (a, b, endsAt) => {
      events.push(['choices', a, b]);
      onChoices(a, b);
    },
    timedOut: async () => events.push(['timed-out']),
    result: async (kind, a, b) => events.push(['result', kind, a, b]),
  };
}

test('fewer than two joiners ends the match after the FIXED window', async () => {
  const channelId = freshChannelId();
  const { game } = createSosGame(channelId, 'g1');
  const io = scriptedIo({ onLobby: () => joinSos(game, 'only-one') });
  const result = await runSosGame(game, io, { joinMs: 0, chooseMs: 0, now: () => 1000 });
  assert.equal(result.outcome, 'not-enough-players');
  assert.deepEqual(io.events.map((e) => e[0]), ['lobby', 'not-enough']);
  assert.equal(getSosGame(channelId), null, 'runner cleans up');
});

test('a full match: three join, two are drawn, both split → both win', async () => {
  const channelId = freshChannelId();
  const { game } = createSosGame(channelId, 'g1');
  const io = scriptedIo({
    onLobby: () => ['p1', 'p2', 'p3'].forEach((id) => joinSos(game, id)),
    onChoices: (a, b) => {
      assert.equal(chooseSos(game, a, 'split').code, 'recorded');
      assert.equal(chooseSos(game, b, 'split').code, 'recorded');
    },
  });
  const result = await runSosGame(game, io, { random: () => 0, joinMs: 0, chooseMs: 50, now: () => 1000 });
  assert.equal(result.outcome, 'both-win');
  assert.deepEqual(result.players, ['p1', 'p2'], 'seeded draw: first two');
  assert.deepEqual(io.events.at(-1), ['result', 'both-win', 'p1', 'p2']);
});

test('steal beats split — and the join window timestamp is passed through', async () => {
  const channelId = freshChannelId();
  const { game } = createSosGame(channelId, 'g1');
  const io = scriptedIo({
    onLobby: () => ['p1', 'p2'].forEach((id) => joinSos(game, id)),
    onChoices: (a, b) => {
      chooseSos(game, b, 'steal');
      chooseSos(game, a, 'split');
    },
  });
  const result = await runSosGame(game, io, { random: () => 0, joinMs: 0, chooseMs: 50, now: () => 5000 });
  assert.equal(result.outcome, 'b-steals');
  assert.equal(io.events[0][1], 5000 + JOIN_WINDOW_MS * 0, 'endsAt = now + joinMs (0 in tests)');
});

test('one silent contestant times the match out', async () => {
  const channelId = freshChannelId();
  const { game } = createSosGame(channelId, 'g1');
  const keepAlive = setInterval(() => {}, 50); // the choice timer is unref'd
  try {
    const io = scriptedIo({
      onLobby: () => ['p1', 'p2'].forEach((id) => joinSos(game, id)),
      onChoices: (a) => chooseSos(game, a, 'steal'), // only one of them acts
    });
    const result = await runSosGame(game, io, { random: () => 0, joinMs: 0, chooseMs: 20, now: () => 0 });
    assert.equal(result.outcome, 'timeout');
    assert.deepEqual(io.events.at(-1), ['timed-out']);
  } finally {
    clearInterval(keepAlive);
  }
});

// ── group wiring ─────────────────────────────────────────────────────────────

test('!splitorsteal is a public group; play refuses a busy channel', async () => {
  const group = sosCommand.group;
  assert.equal(group.name, 'splitorsteal');
  assert.deepEqual(group.aliases, ['sos', 'splitorstealgame']);
  assert.equal(group.permission, undefined, 'anyone can start (cog has no gate)');
  assert.deepEqual(group.subcommands.map((s) => s.name), ['play']);

  const channelId = freshChannelId();
  createSosGame(channelId, 'g1');
  const replies = [];
  const ctx = {
    prefix: '!',
    guild: { id: 'g1' },
    channel: { id: channelId, send: async () => null },
    user: { id: 'u1' },
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
  await group.subcommands[0].run(ctx);
  assert.match(replies[0].content, /already running/);
  assert.match(group.status(ctx).join('\n'), /gathering players|in progress/);
  clearAllSosGames();
});
