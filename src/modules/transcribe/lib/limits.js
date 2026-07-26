// Groq's ACTUAL rate limits, and a budget that mirrors them (S123).
//
// Owner: *"Ik wil geen budgetten gaan gokken, wat zijn de officiele rate
// limits hiervan?"* — fair. The old `dailyLimit: 100` was invented in S101
// when voice memos were the only spender, and nothing about it corresponded to
// anything Groq publishes.
//
// These are Groq's documented FREE-tier limits for the Whisper models, and the
// numbers this module enforces:
//
//   20 requests / minute
//   2,000 requests / day
//   7,200 audio-seconds / hour        (2 hours of audio per clock hour)
//   28,800 audio-seconds / day        (8 hours of audio per day)
//   **10 seconds minimum billed per request**
//
// That last line is the one that matters most here, and it is the reason live
// voice is expensive: our speaker turns are often 1–3 seconds and every one of
// them is charged as 10. Batching them (see `voice-session.js`) is what makes
// the audio-second budget buy a realistic amount of conversation.
//
// Pure: state in, state out, `now` injected. No storage, no network.

/** Groq free tier, both Whisper models. Change these only against the docs. */
export const GROQ_FREE_LIMITS = {
  requestsPerMinute: 20,
  requestsPerDay: 2_000,
  audioSecondsPerHour: 7_200,
  audioSecondsPerDay: 28_800,
  /** Every request is billed at least this much, however short the audio. */
  minBilledSeconds: 10,
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** What a piece of audio actually costs, after Groq's 10-second floor. */
export const billedSeconds = (seconds, limits = GROQ_FREE_LIMITS) =>
  Math.max(limits.minBilledSeconds, Math.ceil(Number(seconds) || 0));

export const emptyUsage = () => ({ requests: [], audio: [] });

/** Drop entries older than the longest window we care about (a day). */
function prune(usage, now) {
  const dayAgo = now - 24 * HOUR;
  return {
    requests: (usage.requests ?? []).filter((t) => t > dayAgo),
    audio: (usage.audio ?? []).filter((e) => e.at > dayAgo),
  };
}

const since = (list, from, pick = (x) => x) => list.filter((e) => pick(e) > from);

/**
 * May one more request of `seconds` of audio go out right now?
 *
 * Returns a **reason and a retry time**, not a boolean: "wait 12s" and "the
 * day's audio budget is gone" need different messages, and a caller that can
 * only say "no" leaves the user guessing (skill 0.5.41).
 *
 * @returns {{ok: boolean, reason: string, retryAfterMs: number, cost: number, usage: object}}
 */
export function checkBudget(usage, seconds, { now = Date.now(), limits = GROQ_FREE_LIMITS } = {}) {
  const pruned = prune(usage ?? emptyUsage(), now);
  const cost = billedSeconds(seconds, limits);

  const perMinute = since(pruned.requests, now - MINUTE);
  if (perMinute.length >= limits.requestsPerMinute) {
    // The oldest request in the window is the one whose expiry frees a slot.
    return {
      ok: false,
      reason: 'rpm',
      retryAfterMs: Math.max(0, perMinute[0] + MINUTE - now),
      cost,
      usage: pruned,
    };
  }

  const perDay = since(pruned.requests, now - 24 * HOUR);
  if (perDay.length >= limits.requestsPerDay) {
    return { ok: false, reason: 'rpd', retryAfterMs: Math.max(0, perDay[0] + 24 * HOUR - now), cost, usage: pruned };
  }

  const audioHour = since(pruned.audio, now - HOUR, (e) => e.at);
  const usedHour = audioHour.reduce((sum, e) => sum + e.seconds, 0);
  if (usedHour + cost > limits.audioSecondsPerHour) {
    return {
      ok: false,
      reason: 'audio-hour',
      retryAfterMs: Math.max(0, (audioHour[0]?.at ?? now) + HOUR - now),
      cost,
      usage: pruned,
    };
  }

  const usedDay = pruned.audio.reduce((sum, e) => sum + e.seconds, 0);
  if (usedDay + cost > limits.audioSecondsPerDay) {
    return {
      ok: false,
      reason: 'audio-day',
      retryAfterMs: Math.max(0, (pruned.audio[0]?.at ?? now) + 24 * HOUR - now),
      cost,
      usage: pruned,
    };
  }

  return { ok: true, reason: 'ok', retryAfterMs: 0, cost, usage: pruned };
}

/** Record a spend. Call only after `checkBudget` said yes AND the call went out. */
export function recordSpend(usage, cost, now = Date.now()) {
  const pruned = prune(usage ?? emptyUsage(), now);
  return {
    requests: [...pruned.requests, now],
    audio: [...pruned.audio, { at: now, seconds: cost }],
  };
}

/** Human-readable state, for the `!transcribe` status line. */
export function describeUsage(usage, { now = Date.now(), limits = GROQ_FREE_LIMITS } = {}) {
  const pruned = prune(usage ?? emptyUsage(), now);
  const minute = since(pruned.requests, now - MINUTE).length;
  const day = pruned.requests.length;
  const audioHour = since(pruned.audio, now - HOUR, (e) => e.at).reduce((s, e) => s + e.seconds, 0);
  const audioDay = pruned.audio.reduce((s, e) => s + e.seconds, 0);
  return {
    minute,
    day,
    audioHour,
    audioDay,
    limits,
    // A percentage of the tightest window is what tells you whether you are
    // about to run out, which a raw count does not.
    tightest: Math.max(
      minute / limits.requestsPerMinute,
      day / limits.requestsPerDay,
      audioHour / limits.audioSecondsPerHour,
      audioDay / limits.audioSecondsPerDay,
    ),
  };
}

/** Why a refusal happened, and what to do about it. */
export const REFUSAL_TEXT = {
  rpm: (wait) => `⏳ Groq allows 20 requests a minute and we are at the cap — retrying in ${Math.ceil(wait / 1000)}s.`,
  rpd: () => '🚫 Groq\'s 2,000 requests for today are used up. It resets on a rolling 24-hour window.',
  'audio-hour': () => '🚫 Two hours of audio in the last hour — Groq\'s hourly ceiling. It frees up as the hour rolls on.',
  'audio-day': () => '🚫 Eight hours of audio today — Groq\'s daily ceiling.',
};
