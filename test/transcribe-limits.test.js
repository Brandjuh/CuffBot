// S123: the budget mirrors Groq's published limits instead of a number
// somebody made up. Owner: "Ik wil geen budgetten gaan gokken, wat zijn de
// officiele rate limits hiervan?"
//
// Every expected limit is typed out again here rather than read off
// GROQ_FREE_LIMITS — a check that takes its expectation from the thing under
// test cannot disagree with it (skill 0.5.35).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GROQ_FREE_LIMITS,
  REFUSAL_TEXT,
  billedSeconds,
  checkBudget,
  describeUsage,
  emptyUsage,
  recordSpend,
} from '../src/modules/transcribe/lib/limits.js';
import {
  BATCH_MAX_WAIT_MS,
  BATCH_TARGET_MS,
  batchingSaving,
  shouldSendBatch,
} from '../src/modules/transcribe/lib/voice-session.js';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Spend `n` requests of `seconds` each, ending at `now`. */
function spend(n, seconds, now = NOW, spacingMs = 0) {
  let usage = emptyUsage();
  for (let i = 0; i < n; i += 1) {
    const at = now - (n - 1 - i) * spacingMs;
    usage = recordSpend(usage, billedSeconds(seconds), at);
  }
  return usage;
}

// ── the published numbers ────────────────────────────────────────────────────

test('the limits are Groq’s documented free-tier numbers', () => {
  assert.equal(GROQ_FREE_LIMITS.requestsPerMinute, 20);
  assert.equal(GROQ_FREE_LIMITS.requestsPerDay, 2_000);
  assert.equal(GROQ_FREE_LIMITS.audioSecondsPerHour, 7_200, '2 hours of audio an hour');
  assert.equal(GROQ_FREE_LIMITS.audioSecondsPerDay, 28_800, '8 hours of audio a day');
  assert.equal(GROQ_FREE_LIMITS.minBilledSeconds, 10);
});

test('Groq’s 10-second floor is applied — a 1.5s turn costs ten', () => {
  // This single rule is why live voice was expensive and why batching matters.
  assert.equal(billedSeconds(1.5), 10);
  assert.equal(billedSeconds(9.9), 10);
  assert.equal(billedSeconds(10), 10);
  assert.equal(billedSeconds(24.2), 25, 'above the floor it rounds up to whole seconds');
  assert.equal(billedSeconds(0), 10, 'even nothing costs the minimum');
});

// ── the windows ──────────────────────────────────────────────────────────────

test('the twentieth request in a minute is fine; the twenty-first waits', () => {
  const usage = spend(20, 2, NOW, 100);
  const verdict = checkBudget(usage, 2, { now: NOW });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'rpm');
  assert.ok(verdict.retryAfterMs > 0, 'and it says how long');
  assert.ok(verdict.retryAfterMs <= MINUTE);
});

test('a minute later the same usage is fine again — the window slides', () => {
  const usage = spend(20, 2, NOW, 100);
  assert.equal(checkBudget(usage, 2, { now: NOW + MINUTE + 1 }).ok, true);
});

test('the hourly AUDIO ceiling bites before the request count does', () => {
  // 7,200 audio-seconds at the 10s floor is 720 requests — well under the
  // 2,000/day request cap, so this is the limit a busy channel meets first.
  const usage = spend(720, 5, NOW, 1_000);
  const verdict = checkBudget(usage, 5, { now: NOW + 2 * MINUTE });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'audio-hour');
});

test('a long recording is refused when it would OVERSHOOT the hour, not after', () => {
  // 7,190 seconds used, a 30-second clip would make 7,220. Refused up front
  // rather than sent and rejected by Groq.
  let usage = emptyUsage();
  usage = recordSpend(usage, 7_190, NOW - MINUTE);
  const verdict = checkBudget(usage, 30, { now: NOW });
  assert.equal(verdict.ok, false);
  assert.equal(verdict.reason, 'audio-hour');
  assert.equal(checkBudget(usage, 5, { now: NOW }).ok, true, '10s still fits');
});

test('an empty budget allows the first request', () => {
  const verdict = checkBudget(emptyUsage(), 3, { now: NOW });
  assert.equal(verdict.ok, true);
  assert.equal(verdict.cost, 10, 'and prices it at the floor');
});

test('every refusal names a reason that has a message', () => {
  for (const reason of ['rpm', 'rpd', 'audio-hour', 'audio-day']) {
    assert.equal(typeof REFUSAL_TEXT[reason], 'function', reason);
    assert.ok(REFUSAL_TEXT[reason](5_000).length > 10, reason);
  }
});

test('entries older than a day are forgotten, so usage cannot grow forever', () => {
  const old = spend(50, 5, NOW - 25 * HOUR, 1_000);
  const described = describeUsage(old, { now: NOW });
  assert.equal(described.day, 0);
  assert.equal(described.audioDay, 0);
});

test('describeUsage reports the tightest window, which is what runs out first', () => {
  const usage = spend(10, 2, NOW, 100); // 10 of 20 per minute = 50%
  const d = describeUsage(usage, { now: NOW });
  assert.equal(d.minute, 10);
  assert.equal(d.day, 10);
  assert.equal(d.audioDay, 100, '10 requests × the 10s floor');
  assert.ok(d.tightest >= 0.5, 'the per-minute window is half gone');
});

// ── batching: the reason the budget goes further ─────────────────────────────

test('a short turn is held; enough audio sends', () => {
  assert.deepEqual(shouldSendBatch({ ms: 1_500, heldSinceMs: 0 }), { send: false, reason: 'hold' });
  assert.deepEqual(shouldSendBatch({ ms: BATCH_TARGET_MS, heldSinceMs: 0 }), { send: true, reason: 'enough' });
});

test('a lone remark is never stranded waiting for a second one', () => {
  // The failure this guards against is a quiet channel where one person says
  // one thing and it is never transcribed at all.
  const held = shouldSendBatch({ ms: 1_200, heldSinceMs: BATCH_MAX_WAIT_MS });
  assert.deepEqual(held, { send: true, reason: 'waited' });
});

test('batching short turns is worth up to ~6x the audio budget', () => {
  // Six 1.5-second turns: unbatched that is 6 × 10s billed = 60s. Batched they
  // total 9s, still billed at the 10s floor once the wait fires.
  const saving = batchingSaving([1_500, 1_500, 1_500, 1_500, 1_500, 1_500]);
  assert.equal(saving.unbatched, 60);
  assert.equal(saving.batched, 10);
  assert.equal(saving.factor, 6);
});

test('batching cannot make long turns cheaper — they were never wasteful', () => {
  // Three 12-second turns already exceed the floor individually, so batching
  // saves nothing. Claiming a saving here would be the arithmetic lying.
  const saving = batchingSaving([12_000, 12_000, 12_000]);
  assert.equal(saving.unbatched, 36, '12s is billed at 12, not at the 10s floor');
  assert.equal(saving.batched, 36);
  assert.equal(saving.factor, 1, 'no saving, and none claimed');
});

test('a trailing partial batch is still billed, not silently dropped', () => {
  const saving = batchingSaving([11_000, 2_000]);
  assert.equal(saving.batched, 21, '11s sent, then 2s at the 10s floor');
  assert.equal(saving.unbatched, 21, 'the same either way — nothing to save here');
});
