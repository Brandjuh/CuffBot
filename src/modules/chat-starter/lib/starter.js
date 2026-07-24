// Pure chat-starter rules — no discord.js, no timers. Decides WHEN a quiet
// channel earns an ice-breaker and WHICH question to post.

export const DEFAULT_STARTER_CONFIG = {
  // Owner decision 2026-07-24: the chat starter runs in this channel after
  // 12 hours of silence — committed as product defaults (like the memorial
  // feeds) so it works out of the box; /chat-starter-config overrides win.
  enabled: true,
  channelId: '411609312037961729',
  idleMinutes: 720, // 12 hours of silence before a starter
  useAi: false, // when true AND the detective has a provider, generate instead of picking
};

export const RECENT_MEMORY = 10; // don't repeat any of the last N questions

/** Validate a question bank document. */
export function validateQuestions(doc) {
  if (!doc || !Array.isArray(doc.questions) || doc.questions.length === 0) {
    return { ok: false, error: 'questions missing or empty' };
  }
  if (!doc.questions.every((q) => typeof q === 'string' && q.trim().length > 0)) {
    return { ok: false, error: 'every question must be a non-empty string' };
  }
  return { ok: true };
}

/**
 * Should the sweep post a starter right now?
 * `humanSinceStarter` guards against the bot monologuing: after one starter,
 * at least one human message must appear before the next one.
 * @returns {{ post:true } | { post:false, reason:string }}
 */
export function shouldPost({ config, idleMs, humanSinceStarter }) {
  if (!config.enabled) return { post: false, reason: 'disabled' };
  if (!config.channelId) return { post: false, reason: 'no-channel' };
  if (!humanSinceStarter) return { post: false, reason: 'no-human-since-last-starter' };
  if (idleMs < config.idleMinutes * 60_000) return { post: false, reason: 'not-idle-enough' };
  return { post: true };
}

/**
 * Pick a question index, avoiding the recently used ones (up to RECENT_MEMORY,
 * but never excluding the entire bank). `random` injectable for tests.
 */
export function pickQuestionIndex(count, recentIndexes = [], random = Math.random) {
  const recent = new Set(recentIndexes.slice(-Math.min(RECENT_MEMORY, Math.max(0, count - 1))));
  const candidates = [];
  for (let i = 0; i < count; i += 1) if (!recent.has(i)) candidates.push(i);
  const pool = candidates.length > 0 ? candidates : [...Array(count).keys()];
  return pool[Math.floor(random() * pool.length)];
}

/** Track a used index in the recent ring. */
export function rememberIndex(recentIndexes, index) {
  return [...(recentIndexes ?? []), index].slice(-RECENT_MEMORY);
}
