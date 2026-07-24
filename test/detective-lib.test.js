import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, humanWait, DEFAULT_LIMITS } from '../src/modules/detective/lib/ratelimit.js';
import {
  LIMITS,
  buildMessages,
  normalizeQuestion,
  normalizeReply,
  pruneHistory,
} from '../src/modules/detective/lib/prompt.js';
import { dailyLimitFor, geminiProvider, groqProvider, pickProvider } from '../src/modules/detective/lib/providers.js';

// ── rate limiting (owner spec: server-wide, 1/7s, 62/hour) ──────────────────

test('limiter enforces the 7-second cooldown between grants', () => {
  const lim = createLimiter();
  const t0 = 1_000_000;
  assert.equal(lim.take(t0).ok, true);
  const tooSoon = lim.take(t0 + 3_000);
  assert.equal(tooSoon.ok, false);
  assert.equal(tooSoon.reason, 'cooldown');
  assert.equal(tooSoon.retryAfterMs, 4_000, 'waits the remaining 4s');
  assert.equal(lim.take(t0 + 7_000).ok, true, 'exactly 7s later is allowed');
});

test('limiter caps at 62 grants per rolling hour, then frees slots as they age out', () => {
  const lim = createLimiter();
  const t0 = 10_000_000;
  for (let i = 0; i < DEFAULT_LIMITS.maxPerHour; i += 1) {
    assert.equal(lim.take(t0 + i * 7_000).ok, true, `grant ${i + 1}`);
  }
  const now = t0 + DEFAULT_LIMITS.maxPerHour * 7_000;
  const refused = lim.take(now);
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'hourly');
  assert.equal(refused.retryAfterMs, t0 + 3_600_000 - now, 'until the oldest grant ages out');
  // One hour after the FIRST grant, one slot is free again.
  assert.equal(lim.take(t0 + 3_600_000).ok, true);
});

test('limiter usage reports the rolling-hour count', () => {
  const lim = createLimiter();
  const t0 = 50_000_000;
  lim.take(t0);
  lim.take(t0 + 8_000);
  assert.deepEqual(lim.usage(t0 + 9_000), { usedThisHour: 2, maxPerHour: 62, usedToday: 2, maxPerDay: null });
  assert.deepEqual(lim.usage(t0 + 3_700_000), { usedThisHour: 0, maxPerHour: 62, usedToday: 2, maxPerDay: null });
});

test('humanWait rounds up to whole seconds/minutes', () => {
  assert.equal(humanWait(1_200), '2s');
  assert.equal(humanWait(59_000), '59s');
  assert.equal(humanWait(61_000), '2m');
});

// ── prompt assembly ──────────────────────────────────────────────────────────

test('normalizeQuestion trims, rejects empties, and cuts overlong questions', () => {
  assert.equal(normalizeQuestion('  hi  '), 'hi');
  assert.equal(normalizeQuestion(''), null);
  assert.equal(normalizeQuestion('   '), null);
  assert.equal(normalizeQuestion(null), null);
  const long = normalizeQuestion('x'.repeat(2_000));
  assert.equal(long.length, LIMITS.maxQuestionChars);
  assert.ok(long.endsWith('…'));
});

test('pruneHistory drops stale entries and caps the tail', () => {
  const now = 1_000_000_000;
  const history = [];
  for (let i = 0; i < 12; i += 1) history.push({ role: 'user', content: `m${i}`, at: now - i * 60_000 });
  history.push({ role: 'user', content: 'ancient', at: now - LIMITS.historyTtlMs - 1 });
  const pruned = pruneHistory(history, now);
  assert.equal(pruned.length, LIMITS.maxHistoryEntries);
  assert.ok(!pruned.some((h) => h.content === 'ancient'));
});

test('buildMessages folds the asker name into the user turn', () => {
  const now = 2_000_000_000;
  const history = [{ role: 'assistant', content: 'earlier answer', at: now - 1_000 }];
  const messages = buildMessages(history, 'Brand', 'what is a 10-4?', now);
  assert.deepEqual(messages, [
    { role: 'assistant', content: 'earlier answer' },
    { role: 'user', content: 'Brand: what is a 10-4?' },
  ]);
});

test('normalizeReply clamps length, neuters @everyone, and survives empties', () => {
  assert.match(normalizeReply(''), /Empty reply/);
  assert.match(normalizeReply(null), /Empty reply/);
  const cut = normalizeReply('y'.repeat(4_000));
  assert.equal(cut.length, LIMITS.maxReplyChars);
  assert.ok(cut.endsWith('…'));
  const neutered = normalizeReply('hello @everyone and @here');
  assert.ok(!neutered.includes('@everyone'), 'zero-width break inserted');
  assert.ok(!neutered.includes('@here'));
});

// ── providers (fake fetch — no network in tests, ever) ───────────────────────

function fakeFetch(response, capture) {
  return async (url, init) => {
    capture.url = url;
    capture.init = init;
    capture.body = JSON.parse(init.body);
    return {
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.json,
      text: async () => response.text ?? '',
    };
  };
}

test('groq provider sends an OpenAI-shaped request and parses the completion', async () => {
  const capture = {};
  const env = { GROQ_API_KEY: 'gsk_test' };
  const reply = await groqProvider.complete({
    system: 'persona',
    messages: [{ role: 'user', content: 'Brand: hi' }],
    env,
    fetchImpl: fakeFetch({ json: { choices: [{ message: { content: '10-4, officer.' } }] } }, capture),
  });
  assert.equal(reply, '10-4, officer.');
  assert.match(capture.url, /api\.groq\.com/);
  assert.equal(capture.init.headers.Authorization, 'Bearer gsk_test');
  assert.equal(capture.body.model, 'llama-3.1-8b-instant');
  assert.equal(capture.body.messages[0].role, 'system');
  assert.equal(capture.body.messages[1].content, 'Brand: hi');
});

test('gemini provider maps roles and reads candidates', async () => {
  const capture = {};
  const env = { GEMINI_API_KEY: 'g_test' };
  const reply = await geminiProvider.complete({
    system: 'persona',
    messages: [
      { role: 'assistant', content: 'earlier' },
      { role: 'user', content: 'Brand: hi' },
    ],
    env,
    fetchImpl: fakeFetch(
      { json: { candidates: [{ content: { parts: [{ text: 'Copy ' }, { text: 'that.' }] } }] } },
      capture,
    ),
  });
  assert.equal(reply, 'Copy that.');
  assert.match(capture.url, /generativelanguage\.googleapis\.com/);
  assert.equal(capture.init.headers['x-goog-api-key'], 'g_test');
  assert.equal(capture.body.contents[0].role, 'model', 'assistant maps to model');
  assert.equal(capture.body.systemInstruction.parts[0].text, 'persona');
});

test('providers throw on HTTP errors and malformed bodies', async () => {
  const env = { GROQ_API_KEY: 'k', GEMINI_API_KEY: 'k' };
  await assert.rejects(
    groqProvider.complete({ system: 's', messages: [], env, fetchImpl: fakeFetch({ ok: false, status: 429, text: 'rate limited' }, {}) }),
    /groq HTTP 429/,
  );
  await assert.rejects(
    groqProvider.complete({ system: 's', messages: [], env, fetchImpl: fakeFetch({ json: {} }, {}) }),
    /no completion/,
  );
  await assert.rejects(
    geminiProvider.complete({ system: 's', messages: [], env, fetchImpl: fakeFetch({ json: { candidates: [] } }, {}) }),
    /no completion/,
  );
});

test('pickProvider: first configured key wins; CUFFBOT_AI_PROVIDER pins explicitly', () => {
  assert.equal(pickProvider({}), null);
  assert.equal(pickProvider({ GROQ_API_KEY: 'a' }).name, 'groq');
  assert.equal(pickProvider({ GEMINI_API_KEY: 'b' }).name, 'gemini');
  assert.equal(pickProvider({ GROQ_API_KEY: 'a', GEMINI_API_KEY: 'b' }).name, 'groq');
  assert.equal(
    pickProvider({ GROQ_API_KEY: 'a', GEMINI_API_KEY: 'b', CUFFBOT_AI_PROVIDER: 'gemini' }).name,
    'gemini',
  );
  assert.equal(pickProvider({ CUFFBOT_AI_PROVIDER: 'groq' }), null, 'pinned but keyless = unconfigured');
});

test('limiter enforces a provider daily cap and frees it after 24 h (S27)', () => {
  const lim = createLimiter({ minIntervalMs: 0, maxPerHour: 1000 });
  const t0 = 700_000_000;
  for (let i = 0; i < 20; i += 1) {
    assert.equal(lim.take(t0 + i * 60_000, { maxPerDay: 20 }).ok, true, `grant ${i + 1}`);
  }
  const refused = lim.take(t0 + 21 * 60_000, { maxPerDay: 20 });
  assert.equal(refused.ok, false);
  assert.equal(refused.reason, 'daily');
  assert.equal(refused.retryAfterMs, t0 + 24 * 3_600_000 - (t0 + 21 * 60_000));
  // No cap when maxPerDay is null.
  assert.equal(lim.take(t0 + 22 * 60_000, { maxPerDay: null }).ok, true);
  // A day after the first grant, a capped slot frees up again.
  assert.equal(lim.take(t0 + 24 * 3_600_000 + 22 * 60_000, { maxPerDay: 20 }).ok, true);
});

test('limiter usage reports daily numbers alongside hourly (S27)', () => {
  const lim = createLimiter({ minIntervalMs: 0 });
  const t0 = 900_000_000;
  lim.take(t0);
  lim.take(t0 + 2 * 3_600_000); // outside the hour window, inside the day
  const use = lim.usage(t0 + 2 * 3_600_000 + 1_000, { maxPerDay: 20 });
  assert.equal(use.usedThisHour, 1);
  assert.equal(use.usedToday, 2);
  assert.equal(use.maxPerDay, 20);
});

test('provider defaults: gemini-2.5-flash-lite + 20/day; groq uncapped (S27, owner spec)', () => {
  assert.equal(geminiProvider.model({}), 'gemini-2.5-flash-lite');
  assert.equal(geminiProvider.dailyLimit, 20);
  assert.equal(groqProvider.dailyLimit, null);
  assert.equal(dailyLimitFor(geminiProvider, {}), 20);
  assert.equal(dailyLimitFor(groqProvider, {}), null);
  assert.equal(dailyLimitFor(geminiProvider, { CUFFBOT_AI_DAILY_LIMIT: '50' }), 50, 'env override wins');
  assert.equal(dailyLimitFor(geminiProvider, { CUFFBOT_AI_DAILY_LIMIT: '0' }), null, '0 disables the cap');
  assert.equal(dailyLimitFor(geminiProvider, { CUFFBOT_AI_DAILY_LIMIT: 'junk' }), 20, 'junk falls back');
});
