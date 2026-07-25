// The chat kill counter (S99 = M20, owner request). The feature IS the timing,
// so every test drives it with an injected `now` and injected timers — nothing
// here waits, and nothing here is flaky.
import { after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import {
  DEFAULT_KILLCOUNTER_CONFIG,
  addKill,
  isCommandLine,
  isEligible,
  leaderboard,
  noteSpeaker,
  resolveSilence,
  standingFor,
} from '../src/modules/killcounter/lib/killcounter.js';
import {
  fireSilence,
  getScores,
  noteMessage,
  pendingIn,
  recordKill,
  resetKillCounterState,
  resetScores,
  setKillCounterConfig,
} from '../src/modules/killcounter/service.js';
import killcounterCommand from '../src/modules/killcounter/commands/killcounter.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-killcounter-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});
beforeEach(() => resetKillCounterState());

let seq = 0;
const freshGuildId = () => `20000000000000${String((seq += 1)).padStart(4, '0')}`;
const ALICE = '800000000000000001';
const BOB = '800000000000000002';
const SILENCE = DEFAULT_KILLCOUNTER_CONFIG.silenceMs;

// ── eligibility ──────────────────────────────────────────────────────────────

const msg = (over = {}) => ({
  authorIsBot: false,
  content: 'hello',
  channelId: 'chan-1',
  ...over,
});

test('a plain human message in an unscoped guild is eligible', () => {
  assert.equal(isEligible(msg(), DEFAULT_KILLCOUNTER_CONFIG), true);
});

test('bots cannot kill a conversation', () => {
  assert.equal(isEligible(msg({ authorIsBot: true }), DEFAULT_KILLCOUNTER_CONFIG), false);
});

test('a command is talking to the bot, not to the room — it never scores', () => {
  const config = DEFAULT_KILLCOUNTER_CONFIG;
  assert.equal(isEligible(msg({ content: '!donuts' }), config), false);
  // …unless an admin turns that off.
  assert.equal(isEligible(msg({ content: '!donuts' }), { ...config, ignoreCommands: false }), true);
  // The router's own rule: a lone prefix or "! spaced" is not a command.
  assert.equal(isCommandLine('!', '!'), false);
  assert.equal(isCommandLine('! hello', '!'), false);
  assert.equal(isCommandLine('!help', '!'), true);
  assert.equal(isCommandLine('hello!', '!'), false);
});

test('an empty channel list means everywhere; a non-empty one means only those', () => {
  const scoped = { ...DEFAULT_KILLCOUNTER_CONFIG, channelIds: ['chan-2'] };
  assert.equal(isEligible(msg({ channelId: 'chan-1' }), scoped), false);
  assert.equal(isEligible(msg({ channelId: 'chan-2' }), scoped), true);
  assert.equal(isEligible(msg({ channelId: 'chan-1' }), DEFAULT_KILLCOUNTER_CONFIG), true);
});

test('a disabled counter is eligible for nothing', () => {
  assert.equal(isEligible(msg(), { ...DEFAULT_KILLCOUNTER_CONFIG, enabled: false }), false);
});

// ── the timing rule ──────────────────────────────────────────────────────────

test('the point lands only once the full silence has passed', () => {
  const pending = noteSpeaker(ALICE, 1_000);
  assert.deepEqual(resolveSilence(pending, 1_000 + SILENCE - 1, SILENCE), { pending, award: null });
  assert.deepEqual(resolveSilence(pending, 1_000 + SILENCE, SILENCE), { pending: null, award: ALICE });
});

test('scoring is idempotent — a second tick cannot award the same silence twice', () => {
  const first = resolveSilence(noteSpeaker(ALICE, 0), SILENCE, SILENCE);
  assert.equal(first.award, ALICE);
  const second = resolveSilence(first.pending, SILENCE * 5, SILENCE);
  assert.equal(second.award, null, 'the pending was cleared as it was awarded');
});

test('nothing pending awards nothing', () => {
  assert.deepEqual(resolveSilence(null, 999_999, SILENCE), { pending: null, award: null });
});

// ── scores ───────────────────────────────────────────────────────────────────

test('addKill never mutates the map it is given', () => {
  const before = { [ALICE]: { kills: 2, lastKillAt: 5 } };
  const after = addKill(before, ALICE, 10);
  assert.deepEqual(before[ALICE], { kills: 2, lastKillAt: 5 }, 'original untouched');
  assert.deepEqual(after[ALICE], { kills: 3, lastKillAt: 10 });
  assert.deepEqual(addKill({}, BOB, 1)[BOB], { kills: 1, lastKillAt: 1 });
});

test('the board ranks by kills, breaking ties on the most recent one', () => {
  const scores = {
    a: { kills: 3, lastKillAt: 10 },
    b: { kills: 5, lastKillAt: 1 },
    c: { kills: 3, lastKillAt: 99 },
    d: { kills: 0, lastKillAt: 0 },
  };
  assert.deepEqual(
    leaderboard(scores).map((r) => r.userId),
    ['b', 'c', 'a'],
    'a zero-kill member is not on the board at all',
  );
  assert.equal(leaderboard(scores, 2).length, 2);
  assert.deepEqual(leaderboard({}), []);
  assert.deepEqual(leaderboard(null), []);
});

test('standingFor reports the rank, and says nothing rather than #0', () => {
  const scores = { a: { kills: 5, lastKillAt: 1 }, b: { kills: 2, lastKillAt: 1 } };
  assert.deepEqual(standingFor(scores, 'b'), { kills: 2, rank: 2, of: 2 });
  assert.deepEqual(standingFor(scores, 'nobody'), { kills: 0, rank: null, of: 2 });
});

// ── the service: arming, resetting, awarding ─────────────────────────────────

/** A message shaped like the real one, with injectable timer capture. */
function speak(guildId, userId, { channelId = 'chan-1', content = 'hi', bot = false } = {}) {
  return {
    author: { id: userId, bot },
    content,
    channelId,
    client: { config: { prefix: '!' } },
  };
}

/** Timer injection: nothing fires on its own, tests fire it. */
function fakeTimers() {
  const armed = [];
  return {
    armed,
    io: {
      setTimer: (fn, ms) => {
        const handle = { fn, ms, cleared: false };
        armed.push(handle);
        return handle;
      },
      clearTimer: (handle) => {
        if (handle) handle.cleared = true;
      },
    },
  };
}

test('speaking arms a timer and makes you the pending killer', () => {
  const guildId = freshGuildId();
  const timers = fakeTimers();
  assert.equal(noteMessage(guildId, speak(guildId, ALICE), { now: 0, ...timers.io }), true);
  assert.equal(pendingIn('chan-1').userId, ALICE);
  assert.equal(timers.armed.length, 1);
  assert.equal(timers.armed[0].ms, SILENCE);
});

test('a new message REPLACES the pending kill — that is the reset', () => {
  const guildId = freshGuildId();
  const timers = fakeTimers();
  noteMessage(guildId, speak(guildId, ALICE), { now: 0, ...timers.io });
  noteMessage(guildId, speak(guildId, BOB), { now: 5_000, ...timers.io });

  assert.equal(pendingIn('chan-1').userId, BOB, 'only the last word is holding the knife');
  assert.equal(timers.armed[0].cleared, true, 'the old timer was disarmed');
  assert.equal(timers.armed.length, 2);
});

test('an ineligible message neither arms nor disturbs what is pending', () => {
  const guildId = freshGuildId();
  const timers = fakeTimers();
  noteMessage(guildId, speak(guildId, ALICE), { now: 0, ...timers.io });

  assert.equal(noteMessage(guildId, speak(guildId, BOB, { bot: true }), { now: 1, ...timers.io }), false);
  assert.equal(noteMessage(guildId, speak(guildId, BOB, { content: '!help' }), { now: 2, ...timers.io }), false);
  assert.equal(pendingIn('chan-1').userId, ALICE, 'still Alice on the hook');
  assert.equal(timers.armed.length, 1, 'no extra timers');
});

test('channels are independent — one busy channel does not save another', async () => {
  const guildId = freshGuildId();
  const timers = fakeTimers();
  noteMessage(guildId, speak(guildId, ALICE, { channelId: 'quiet' }), { now: 0, ...timers.io });
  noteMessage(guildId, speak(guildId, BOB, { channelId: 'busy' }), { now: 0, ...timers.io });
  noteMessage(guildId, speak(guildId, ALICE, { channelId: 'busy' }), { now: 1_000, ...timers.io });

  assert.equal(pendingIn('quiet').userId, ALICE);
  assert.equal(pendingIn('busy').userId, ALICE);
  const killed = await fireSilence(guildId, 'quiet', { now: SILENCE });
  assert.equal(killed.userId, ALICE);
  assert.equal(pendingIn('busy').userId, ALICE, 'the other channel is untouched');
});

test('firing early does not score, and leaves the kill pending', async () => {
  const guildId = freshGuildId();
  const timers = fakeTimers();
  noteMessage(guildId, speak(guildId, ALICE), { now: 0, ...timers.io });

  assert.equal(await fireSilence(guildId, 'chan-1', { now: SILENCE - 1 }), null);
  assert.equal(pendingIn('chan-1').userId, ALICE, 'still on the hook');
  const killed = await fireSilence(guildId, 'chan-1', { now: SILENCE });
  assert.equal(killed.userId, ALICE);
  assert.equal(killed.total, 1);
});

test('a duplicate fire cannot double-score', async () => {
  const guildId = freshGuildId();
  const timers = fakeTimers();
  noteMessage(guildId, speak(guildId, ALICE), { now: 0, ...timers.io });
  await fireSilence(guildId, 'chan-1', { now: SILENCE });
  assert.equal(await fireSilence(guildId, 'chan-1', { now: SILENCE * 2 }), null);
  assert.equal(getScores(guildId)[ALICE].kills, 1);
});

test('kills persist and accumulate', () => {
  const guildId = freshGuildId();
  assert.equal(recordKill(guildId, ALICE, 1), 1);
  assert.equal(recordKill(guildId, ALICE, 2), 2);
  assert.equal(recordKill(guildId, BOB, 3), 1);
  assert.equal(getScores(guildId)[ALICE].kills, 2);
  resetScores(guildId);
  assert.deepEqual(getScores(guildId), {});
});

test('a scoped guild ignores messages outside its channels entirely', () => {
  const guildId = freshGuildId();
  setKillCounterConfig(guildId, { channelIds: ['allowed'] });
  const timers = fakeTimers();
  assert.equal(
    noteMessage(guildId, speak(guildId, ALICE, { channelId: 'elsewhere' }), { now: 0, ...timers.io }),
    false,
  );
  assert.equal(
    noteMessage(guildId, speak(guildId, ALICE, { channelId: 'allowed' }), { now: 0, ...timers.io }),
    true,
  );
});

// ── the command surface ──────────────────────────────────────────────────────

const group = killcounterCommand.group;
const sub = (name) => group.subcommands.find((s) => s.name === name);

function fakeCtx(guildId, userId = ALICE) {
  const replies = [];
  return {
    replies,
    guild: { id: guildId },
    user: { id: userId, toString: () => `<@${userId}>` },
    prefix: '!',
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

test('!killcounter me reports your tally and your rank', async () => {
  const guildId = freshGuildId();
  recordKill(guildId, ALICE, 1);
  recordKill(guildId, ALICE, 2);
  const ctx = fakeCtx(guildId);
  await sub('me').run(ctx, {});
  assert.match(ctx.replies[0].content, /\*\*2\*\* chat kills — #1 of 1/);
});

test('!killcounter me is kind about a clean record', async () => {
  const ctx = fakeCtx(freshGuildId());
  await sub('me').run(ctx, {});
  assert.match(ctx.replies[0].content, /not killed a single conversation/);
});

test('!killcounter board ranks, and says so when nothing has died', async () => {
  const guildId = freshGuildId();
  const empty = fakeCtx(guildId);
  await sub('board').run(empty, {});
  assert.match(
    empty.replies[0].embeds[0].data.description,
    /No conversations have died yet/,
  );

  recordKill(guildId, BOB, 1);
  recordKill(guildId, BOB, 2);
  recordKill(guildId, ALICE, 3);
  const ctx = fakeCtx(guildId);
  await sub('board').run(ctx, {});
  const desc = ctx.replies[0].embeds[0].data.description;
  assert.ok(desc.indexOf(BOB) < desc.indexOf(ALICE), 'two kills outrank one');
  assert.match(desc, /🥇/);
});

test('!killcounter channel toggles a channel, and an empty list means everywhere again', async () => {
  const guildId = freshGuildId();
  const ctx = fakeCtx(guildId);
  const channel = { id: 'chan-x', toString: () => '<#chan-x>' };

  await sub('channel').run(ctx, { channel });
  assert.match(ctx.replies[0].content, /only.*<#chan-x>/is);

  await sub('channel').run(ctx, { channel });
  assert.match(ctx.replies[1].content, /no longer counted/);
  assert.match(ctx.replies[1].content, /everywhere/, 'the empty list is explained, not silent');
});

test('!killcounter reset demands the word confirm', async () => {
  const guildId = freshGuildId();
  recordKill(guildId, ALICE, 1);
  const ctx = fakeCtx(guildId);

  await sub('reset').run(ctx, {});
  assert.match(ctx.replies[0].content, /reset confirm/);
  assert.equal(getScores(guildId)[ALICE].kills, 1, 'nothing wiped without the word');

  await sub('reset').run(ctx, { confirm: 'confirm' });
  assert.deepEqual(getScores(guildId), {});
});

test('reading is public; every knob is Manage Server', () => {
  for (const name of ['me', 'board']) {
    assert.equal(sub(name).permission, undefined, `!killcounter ${name} is public`);
  }
  for (const name of ['on', 'off', 'silence', 'channel', 'everywhere', 'reset']) {
    assert.equal(sub(name).permission, PermissionFlagsBits.ManageGuild, `!killcounter ${name}`);
  }
});

test('the group status reports the scope and your own standing', async () => {
  const guildId = freshGuildId();
  recordKill(guildId, ALICE, 1);
  const lines = (await group.status(fakeCtx(guildId))).join('\n');
  assert.match(lines, /Silence needed:\*\* 30 s/);
  assert.match(lines, /Channels:\*\* everywhere/);
  assert.match(lines, /Your kills:\*\* 1 — #1 of 1/);
});

test('`!killcounter @member` reads as `!killcounter me @member` (the fallback)', () => {
  assert.equal(group.fallback, 'me');
});
