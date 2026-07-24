import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { askDetective, forgetAllConversations, setAiConfig } from '../src/modules/detective/service.js';
import ask from '../src/modules/detective/commands/ask.js';
import aiConfig from '../src/modules/detective/commands/ai-config.js';
import mentionReply, { stripBotMention } from '../src/modules/detective/events/mention-reply.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-detective-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
// The suite must be deterministic on any machine: no ambient AI keys.
delete process.env.GROQ_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.CUFFBOT_AI_PROVIDER;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
function freshGuildId() {
  seq += 1;
  return `80000000000000${String(seq).padStart(4, '0')}`;
}

// The service's limiter is process-global; keep every test's `now` far apart
// (2h steps) so no test inherits another's cooldown or hourly usage.
let clock = 100_000_000;
function freshNow() {
  clock += 2 * 3_600_000;
  return clock;
}

const GROQ_OK = {
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: 'Copy that, officer.' } }] }),
  text: async () => '',
};

test('askDetective happy path: provider reply lands, conversation is remembered', async () => {
  forgetAllConversations();
  const guildId = freshGuildId();
  const now = freshNow();
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(JSON.parse(init.body));
    return GROQ_OK;
  };
  const env = { GROQ_API_KEY: 'k' };
  const first = await askDetective({ guildId, channelId: 'c1', askerName: 'Brand', question: 'what is a 10-4?', now, env, fetchImpl });
  assert.equal(first.ok, true);
  assert.equal(first.reply, 'Copy that, officer.');
  // Second question (past the cooldown) carries the first exchange as history.
  const second = await askDetective({ guildId, channelId: 'c1', askerName: 'Brand', question: 'and a 10-9?', now: now + 8_000, env, fetchImpl });
  assert.equal(second.ok, true);
  const history = calls[1].messages.map((m) => m.content);
  assert.ok(history.some((c) => c === 'Brand: what is a 10-4?'), 'previous question included');
  assert.ok(history.some((c) => c === 'Copy that, officer.'), 'previous answer included');
});

test('askDetective without any API key explains configuration, spends no budget', async () => {
  const result = await askDetective({
    guildId: freshGuildId(), channelId: 'c2', askerName: 'B', question: 'hi',
    now: freshNow(), env: {},
    fetchImpl: async () => { throw new Error('must not be called'); },
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /GROQ_API_KEY|GEMINI_API_KEY/);
});

test('askDetective parks a cooldown-refused question on the desk pile (S29)', async () => {
  const { clearQueue } = await import('../src/modules/detective/service.js');
  clearQueue();
  const guildId = freshGuildId();
  const now = freshNow();
  const env = { GROQ_API_KEY: 'k' };
  const fetchImpl = async () => GROQ_OK;
  assert.equal((await askDetective({ guildId, channelId: 'c3', askerName: 'A', question: 'q1', now, env, fetchImpl })).ok, true);
  const refused = await askDetective({ guildId, channelId: 'c3', askerName: 'B', question: 'q2', userId: 'u-c3', now: now + 2_000, env, fetchImpl });
  assert.equal(refused.ok, false);
  assert.equal(refused.queued, true, 'cooldown refusals are parked, not lost');
  assert.match(refused.message, /desk pile/);
  clearQueue();
});

test('askDetective maps provider failures to a friendly message, never throws', async () => {
  const result = await askDetective({
    guildId: freshGuildId(), channelId: 'c4', askerName: 'B', question: 'hi',
    now: freshNow(), env: { GROQ_API_KEY: 'k' },
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}), text: async () => 'boom' }),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /provider error/);
});

test('askDetective respects the enabled switch', async () => {
  const guildId = freshGuildId();
  setAiConfig(guildId, { enabled: false });
  const result = await askDetective({
    guildId, channelId: 'c5', askerName: 'B', question: 'hi',
    now: freshNow(), env: { GROQ_API_KEY: 'k' }, fetchImpl: async () => GROQ_OK,
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /off duty/);
});

test('askDetective refuses empty questions without spending budget', async () => {
  const guildId = freshGuildId();
  const now = freshNow();
  const env = { GROQ_API_KEY: 'k' };
  const empty = await askDetective({ guildId, channelId: 'c6', askerName: 'B', question: '   ', now, env, fetchImpl: async () => GROQ_OK });
  assert.equal(empty.ok, false);
  assert.match(empty.message, /Ask me something/);
  // The budget was not consumed: an immediate real question still passes.
  const real = await askDetective({ guildId, channelId: 'c6', askerName: 'B', question: 'hi', now: now + 1_000, env, fetchImpl: async () => GROQ_OK });
  assert.equal(real.ok, true);
});

// ── /ask command (defer → editReply) ─────────────────────────────────────────

test('/ask defers, then edits in the pipeline result', async () => {
  const state = { deferred: false, edited: null };
  await ask.execute({
    guild: { id: freshGuildId() },
    channel: { id: 'chan' },
    member: { displayName: 'Brand' },
    user: { username: 'brand' },
    options: { getString: () => 'a question' },
    deferReply: async () => { state.deferred = true; },
    editReply: async (p) => { state.edited = p; },
  });
  assert.equal(state.deferred, true, 'must defer before the slow provider call');
  // No key in process.env → the configuration message is the expected outcome.
  assert.match(state.edited.content, /No AI provider is configured/);
  assert.deepEqual(state.edited.allowedMentions, { parse: [] });
});

test('/ai-config toggles the switch and reports status', async () => {
  const guildId = freshGuildId();
  const replies = [];
  const ix = (enabled) => ({
    guild: { id: guildId },
    memberPermissions: { has: () => true },
    options: { getBoolean: () => enabled },
    reply: async (p) => replies.push(p),
  });
  await aiConfig.execute(ix(false));
  await aiConfig.execute(ix(null)); // view
  const desc = replies[1].embeds[0].toJSON().description;
  assert.match(desc, /\*\*Enabled:\*\* no/);
  assert.match(desc, /1 question \/ 7 s · max 62 \/ hour/);
  assert.match(desc, /⚠️ none/, 'keyless environment shows the provider warning');
});

// ── mention-reply event ──────────────────────────────────────────────────────

function fakeMentionMessage({ content, botMentioned = true, everyone = false, contentAvailable = true }) {
  const replies = [];
  const message = {
    content,
    system: false,
    author: { bot: false, username: 'brand' },
    member: { displayName: 'Brand' },
    guild: { id: 'g-home' },
    channel: { id: 'chan', sendTyping: async () => {} },
    mentions: {
      everyone,
      users: { has: (id) => botMentioned && id === 'bot-1' },
    },
    client: {
      user: { id: 'bot-1' },
      config: { homeGuildId: 'g-home', prefix: '!' },
      messageContentAvailable: contentAvailable,
    },
    reply: async (p) => replies.push(p),
  };
  return { message, replies };
}

test('stripBotMention removes user/nick/role mention forms', () => {
  assert.equal(stripBotMention('<@bot-1> hello', 'bot-1'), 'hello');
  assert.equal(stripBotMention('<@!bot-1> hello <@bot-1>', 'bot-1'), 'hello');
  assert.equal(stripBotMention('hey <@&bot-1> there', 'bot-1'), 'hey there');
});

test('mentioning the bot replies through the pipeline (keyless → config hint)', async () => {
  const { message, replies } = fakeMentionMessage({ content: '<@bot-1> what is a 10-4?' });
  await mentionReply.execute(message);
  assert.equal(replies.length, 1);
  assert.match(replies[0].content, /No AI provider is configured/);
  assert.deepEqual(replies[0].allowedMentions, { parse: [], repliedUser: true });
});

test('mention event ignores @everyone, non-mentions, bots, and missing intent', async () => {
  const cases = [
    fakeMentionMessage({ content: '@everyone party!', everyone: true }),
    fakeMentionMessage({ content: 'no mention here', botMentioned: false }),
    fakeMentionMessage({ content: '<@bot-1> hi', contentAvailable: false }),
  ];
  const botMsg = fakeMentionMessage({ content: '<@bot-1> hi' });
  botMsg.message.author.bot = true;
  cases.push(botMsg);
  for (const { message, replies } of cases) {
    await mentionReply.execute(message);
    assert.equal(replies.length, 0);
  }
});

test('mention event leaves prefix commands to the prefix router', async () => {
  const { message, replies } = fakeMentionMessage({ content: '!ask <@bot-1> hi' });
  await mentionReply.execute(message);
  assert.equal(replies.length, 0, '!-prefixed messages are not answered here');
});

test('askDetective enforces the provider daily cap with a specific refusal (S27)', async () => {
  const guildId = freshGuildId();
  clock += 30 * 3_600_000; // clean rolling-24h window: no stamps from earlier tests
  const base = clock;
  const env = { GEMINI_API_KEY: 'k' };
  const GEMINI_OK = {
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'Copy.' }] } }] }),
    text: async () => '',
  };
  // Twenty grants (spaced past the 7 s cooldown), then the daily wall.
  for (let i = 0; i < 20; i += 1) {
    const r = await askDetective({ guildId, channelId: 'cd', askerName: 'A', question: `q${i}`, now: base + i * 8_000, env, fetchImpl: async () => GEMINI_OK });
    assert.equal(r.ok, true, `grant ${i + 1}`);
  }
  const refused = await askDetective({ guildId, channelId: 'cd', askerName: 'A', question: 'q21', now: base + 21 * 8_000, env, fetchImpl: async () => GEMINI_OK });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /DAILY detective budget \(20 questions/);
});

test('a provider HTTP 429 gets the quota message, not the generic one (S27)', async () => {
  const result = await askDetective({
    guildId: freshGuildId(), channelId: 'c429', askerName: 'B', question: 'hi',
    now: freshNow(), env: { GROQ_API_KEY: 'k' },
    fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({}), text: async () => 'quota' }),
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /free-tier quota/);
});

// ── S29: the desk pile (rate-limited questions answered automatically) ───────

test('queue rules: replace-per-user, cap, shouldQueue, story format (S29)', async () => {
  const { enqueueQuestion, shouldQueue, waitStory, QUEUE_CAP } = await import('../src/modules/detective/lib/queue.js');
  let q = [];
  const item = (userId, question) => ({ userId, channelId: 'c', askerName: 'A', question, queuedAt: 1 });
  const first = enqueueQuestion(q, item('u1', 'q1'));
  assert.equal(first.status, 'queued');
  assert.equal(first.position, 1);
  q = first.queue;
  const replaced = enqueueQuestion(q, item('u1', 'q2'));
  assert.equal(replaced.status, 'replaced');
  assert.equal(replaced.queue.length, 1);
  assert.equal(replaced.queue[0].question, 'q2', 'latest question wins');
  q = replaced.queue;
  for (let i = 2; i <= QUEUE_CAP; i += 1) q = enqueueQuestion(q, item(`u${i}`, 'x')).queue;
  assert.equal(enqueueQuestion(q, item('u-new', 'x')).status, 'full');
  assert.equal(shouldQueue('cooldown', 5_000), true);
  assert.equal(shouldQueue('hourly', 30 * 60_000), true);
  assert.equal(shouldQueue('daily', 5_000), false, 'daily never queues');
  assert.equal(shouldQueue('hourly', 2 * 3_600_000), false, 'too-long waits never queue');
  assert.match(waitStory(3, 2, '8s'), /#2 on the desk pile/);
  assert.match(waitStory(3, 2, '8s'), /~8s/);
});

test('a cooldown-refused question is parked with a story, then answered automatically (S29)', async () => {
  const { clearQueue, pendingCount, flushQueue } = await import('../src/modules/detective/service.js');
  clearQueue();
  const guildId = freshGuildId();
  const base = freshNow();
  const env = { GROQ_API_KEY: 'k' };
  const fetchImpl = async () => GROQ_OK;

  assert.equal((await askDetective({ guildId, channelId: 'park-chan', askerName: 'A', question: 'first', userId: 'u-a', now: base, env, fetchImpl })).ok, true);
  const parked = await askDetective({ guildId, channelId: 'park-chan', askerName: 'B', question: 'What is a 10-4?', userId: 'u-b', now: base + 2_000, env, fetchImpl });
  assert.equal(parked.ok, false);
  assert.equal(parked.queued, true);
  assert.match(parked.message, /desk pile/);
  assert.equal(pendingCount(), 1);

  // Too soon: the flusher stays quiet.
  const sends = [];
  const client = { channels: { cache: new Map([['park-chan', { id: 'park-chan', send: async (p) => (sends.push(p), p) }]]) } };
  assert.equal(await flushQueue(client, { now: base + 3_000, env, fetchImpl }), 0);
  assert.equal(pendingCount(), 1);

  // Past the cooldown: the parked question is answered in its channel, pinging the asker.
  assert.equal(await flushQueue(client, { now: base + 8_000, env, fetchImpl }), 1);
  assert.equal(pendingCount(), 0);
  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /<@u-b>/);
  assert.match(sends[0].content, /What is a 10-4\?/, 'original question echoed');
  assert.match(sends[0].content, /Copy that, officer\./, 'the actual answer');
  assert.deepEqual(sends[0].allowedMentions, { users: ['u-b'] });
  clearQueue();
});

test('flushQueue survives a dead channel and drops disabled-guild items (S29)', async () => {
  const { clearQueue, pendingCount, flushQueue } = await import('../src/modules/detective/service.js');
  clearQueue();
  const guildId = freshGuildId();
  const base = freshNow();
  const env = { GROQ_API_KEY: 'k' };
  const fetchImpl = async () => GROQ_OK;
  assert.equal((await askDetective({ guildId, channelId: 'gone-chan', askerName: 'A', question: 'q1', userId: 'u-a', now: base, env, fetchImpl })).ok, true);
  const parked = await askDetective({ guildId, channelId: 'gone-chan', askerName: 'B', question: 'q2', userId: 'u-b', now: base + 2_000, env, fetchImpl });
  assert.equal(parked.queued, true);

  // Channel vanished: the slot is spent but nothing crashes.
  const client = { channels: { cache: new Map() } };
  assert.equal(await flushQueue(client, { now: base + 10_000, env, fetchImpl }), 0);
  assert.equal(pendingCount(), 0, 'item consumed, no retry loop');

  // Disabled guild: parked items are dropped without an AI call.
  const g2 = freshGuildId();
  const t2 = freshNow();
  assert.equal((await askDetective({ guildId: g2, channelId: 'c', askerName: 'A', question: 'q1', userId: 'u-a', now: t2, env, fetchImpl })).ok, true);
  assert.equal((await askDetective({ guildId: g2, channelId: 'c', askerName: 'B', question: 'q2', userId: 'u-b', now: t2 + 2_000, env, fetchImpl })).queued, true);
  setAiConfig(g2, { enabled: false });
  assert.equal(await flushQueue(client, { now: t2 + 10_000, env, fetchImpl }), 0);
  assert.equal(pendingCount(), 0, 'disabled-guild item dropped');
  setAiConfig(g2, { enabled: true });
  clearQueue();
});

test('daily refusals do NOT park and say so (S29)', async () => {
  const { clearQueue, pendingCount } = await import('../src/modules/detective/service.js');
  clearQueue();
  const guildId = freshGuildId();
  clock += 30 * 3_600_000; // clean rolling-24h window: no stamps from earlier tests
  const base = clock;
  const env = { GEMINI_API_KEY: 'k', CUFFBOT_AI_DAILY_LIMIT: '1' };
  const GEMINI_OK = {
    ok: true, status: 200,
    json: async () => ({ candidates: [{ content: { parts: [{ text: 'Copy.' }] } }] }),
    text: async () => '',
  };
  assert.equal((await askDetective({ guildId, channelId: 'c', askerName: 'A', question: 'q1', userId: 'u1', now: base, env, fetchImpl: async () => GEMINI_OK })).ok, true);
  const refused = await askDetective({ guildId, channelId: 'c', askerName: 'B', question: 'q2', userId: 'u2', now: base + 8_000, env, fetchImpl: async () => GEMINI_OK });
  assert.equal(refused.ok, false);
  assert.equal(refused.queued, undefined, 'not parked');
  assert.match(refused.message, /Come back tomorrow/);
  assert.equal(pendingCount(), 0);
  clearQueue();
});
