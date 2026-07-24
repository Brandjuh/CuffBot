import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_STARTER_CONFIG,
  pickQuestionIndex,
  rememberIndex,
  RECENT_MEMORY,
  shouldPost,
  validateQuestions,
} from '../src/modules/chat-starter/lib/starter.js';
import {
  activityFor,
  aiQuestion,
  markStarterPosted,
  nextQuestion,
  noteActivity,
  questionBank,
  resetActivity,
  setStarterConfig,
} from '../src/modules/chat-starter/service.js';
import activityWatch from '../src/modules/chat-starter/events/activity-watch.js';
import { sweepStarter } from '../src/modules/chat-starter/events/starter-sweep.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-starter-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.CUFFBOT_AI_PROVIDER;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
  resetActivity();
});

let seq = 0;
const freshGuildId = () => `30000000000000${String((seq += 1)).padStart(4, '0')}`;

// ── pure rules ───────────────────────────────────────────────────────────────

test('the shipped question bank is valid and reasonably sized', () => {
  const bank = questionBank({ force: true });
  assert.ok(bank.length >= 30, `expected 30+ questions, got ${bank.length}`);
  assert.equal(validateQuestions({ questions: bank }).ok, true);
});

test('validateQuestions rejects malformed banks', () => {
  assert.equal(validateQuestions(null).ok, false);
  assert.equal(validateQuestions({ questions: [] }).ok, false);
  assert.equal(validateQuestions({ questions: ['ok', ''] }).ok, false);
});

test('shouldPost: opt-in, channel required, idle threshold, human guard', () => {
  const config = { ...DEFAULT_STARTER_CONFIG, enabled: true, channelId: 'c', idleMinutes: 60 };
  const base = { config, idleMs: 61 * 60_000, humanSinceStarter: true };
  assert.equal(shouldPost(base).post, true);
  assert.equal(shouldPost({ ...base, idleMs: 59 * 60_000 }).reason, 'not-idle-enough');
  assert.equal(shouldPost({ ...base, humanSinceStarter: false }).reason, 'no-human-since-last-starter');
  assert.equal(shouldPost({ ...base, config: { ...config, enabled: false } }).reason, 'disabled');
  assert.equal(shouldPost({ ...base, config: { ...config, channelId: null } }).reason, 'no-channel');
});

test('pickQuestionIndex avoids the recent ring but never starves', () => {
  const recent = [0, 1, 2];
  for (let i = 0; i < 20; i += 1) {
    const idx = pickQuestionIndex(5, recent, Math.random);
    assert.ok(idx === 3 || idx === 4, `must avoid recent, got ${idx}`);
  }
  // Tiny bank: recent covers everything → still returns something valid.
  const idx = pickQuestionIndex(2, [0, 1], () => 0.5);
  assert.ok(idx === 0 || idx === 1);
  assert.equal(pickQuestionIndex(1, [0], () => 0.9), 0);
});

test('rememberIndex keeps a bounded ring', () => {
  let ring = [];
  for (let i = 0; i < 25; i += 1) ring = rememberIndex(ring, i);
  assert.equal(ring.length, RECENT_MEMORY);
  assert.equal(ring[ring.length - 1], 24);
});

// ── activity tracking ────────────────────────────────────────────────────────

test('activity: humans re-arm the starter, the bot marking a post disarms it', () => {
  resetActivity();
  const now = 1_000_000;
  const first = activityFor('chan', now);
  assert.equal(first.humanSinceStarter, true, 'first sight allows a starter');
  markStarterPosted('chan', now + 1_000);
  assert.equal(activityFor('chan').humanSinceStarter, false);
  noteActivity('chan', { human: false, now: now + 2_000 });
  assert.equal(activityFor('chan').humanSinceStarter, false, 'other bots reset the clock, not the guard');
  noteActivity('chan', { human: true, now: now + 3_000 });
  assert.equal(activityFor('chan').humanSinceStarter, true);
});

test('activity-watch event: only the configured channel, never the bot itself', async () => {
  resetActivity();
  const guildId = freshGuildId();
  setStarterConfig(guildId, { channelId: 'watched' });
  const msg = (channelId, authorId, bot = false) => ({
    guild: { id: 'g-home' },
    channelId,
    author: { id: authorId, bot },
    client: { config: { homeGuildId: 'g-home' }, user: { id: 'cuffbot' } },
  });
  // Patch guild id to match config lookups.
  const message = msg('watched', 'human-1');
  message.guild.id = 'g-home';
  message.client.config.homeGuildId = 'g-home';
  // The event reads config by message.guild.id — align it with our fresh guild.
  message.guild.id = guildId;
  await activityWatch.execute(message);
  assert.ok(activityFor('watched').humanSinceStarter);

  markStarterPosted('watched');
  const own = msg('watched', 'cuffbot');
  own.guild.id = guildId;
  await activityWatch.execute(own);
  assert.equal(activityFor('watched').humanSinceStarter, false, "the bot's own messages don't re-arm");
});

// ── question selection + sweep ───────────────────────────────────────────────

test('nextQuestion draws from the list and rotates through the recent ring', async () => {
  const guildId = freshGuildId();
  const config = { ...DEFAULT_STARTER_CONFIG, useAi: false };
  const seen = new Set();
  for (let i = 0; i < 5; i += 1) {
    const q = await nextQuestion(guildId, config);
    assert.equal(typeof q, 'string');
    seen.add(q);
  }
  assert.equal(seen.size, 5, 'five consecutive draws never repeat');
});

test('aiQuestion returns null without a provider and falls back cleanly', async () => {
  assert.equal(await aiQuestion({}), null);
  const guildId = freshGuildId();
  const q = await nextQuestion(guildId, { ...DEFAULT_STARTER_CONFIG, useAi: true });
  assert.equal(typeof q, 'string', 'useAi without a key still yields a list question');
});

test('aiQuestion uses the provider when configured, rejects junk output', async () => {
  const env = { GROQ_API_KEY: 'k' };
  const good = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'What made you smile today?' } }] }),
    text: async () => '',
  });
  assert.equal(await aiQuestion(env, good), 'What made you smile today?');
  const junk = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    text: async () => '',
  });
  assert.equal(await aiQuestion(env, junk), null, 'too-short output rejected');
});

function fakeGuild(guildId, { sendWorks = true } = {}) {
  const sends = [];
  const channel = {
    id: 'quiet-chan',
    send: async (p) => {
      if (!sendWorks) throw new Error('no perms');
      sends.push(p);
      return p;
    },
  };
  return { id: guildId, channels: { cache: new Map([['quiet-chan', channel]]) }, sends };
}

test('sweepStarter posts after the idle window, then waits for a human before the next', async () => {
  resetActivity();
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  setStarterConfig(guildId, { enabled: true, channelId: 'quiet-chan', idleMinutes: 60 });

  const t0 = 5_000_000;
  noteActivity('quiet-chan', { human: true, now: t0 });
  assert.equal(await sweepStarter(guild, t0 + 30 * 60_000), false, 'not idle enough yet');
  assert.equal(await sweepStarter(guild, t0 + 61 * 60_000), true, 'idle window passed');
  assert.equal(guild.sends.length, 1);
  assert.match(guild.sends[0].content, /Radio check, precinct/);
  assert.deepEqual(guild.sends[0].allowedMentions, { parse: [] });

  // Another idle window with NO human in between → silence (no monologue).
  assert.equal(await sweepStarter(guild, t0 + 200 * 60_000), false);
  assert.equal(guild.sends.length, 1);

  // A human speaks → the next idle window earns a new starter.
  noteActivity('quiet-chan', { human: true, now: t0 + 200 * 60_000 });
  assert.equal(await sweepStarter(guild, t0 + 261 * 60_000), true);
  assert.equal(guild.sends.length, 2);
});

test('sweepStarter is a no-op when disabled/unconfigured and survives send failures', async () => {
  resetActivity();
  const guildId = freshGuildId();
  assert.equal(await sweepStarter(fakeGuild(guildId), 1_000), false, 'disabled by default');

  setStarterConfig(guildId, { enabled: true, channelId: 'quiet-chan', idleMinutes: 15 });
  const broken = fakeGuild(guildId, { sendWorks: false });
  noteActivity('quiet-chan', { human: true, now: 1_000 });
  assert.equal(await sweepStarter(broken, 1_000 + 16 * 60_000), false, 'send failed, no crash');
  // The guard was NOT consumed by the failure — a later sweep retries.
  const healthy = fakeGuild(guildId);
  assert.equal(await sweepStarter(healthy, 1_000 + 17 * 60_000), true);
});
