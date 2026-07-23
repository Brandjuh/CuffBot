// Pure, GLOBAL rate limiting for AI calls — no discord.js imports, no timers.
// Owner's spec (S16): the WHOLE server shares one budget — 1 AI message per
// 7 seconds AND at most 62 AI messages per rolling hour. Three people typing
// at once draw from the same single budget; there is no per-user allowance.
// The caller injects `now` everywhere, so every rule is unit-testable.

export const DEFAULT_LIMITS = {
  minIntervalMs: 7_000, // at most one AI message per 7 seconds, server-wide
  maxPerHour: 62, // at most 62 AI messages per rolling hour, server-wide
};

/**
 * Create a global limiter. State lives in memory: a restart forgets at most
 * one hour of history, which can only make the limiter briefly MORE generous —
 * acceptable for protecting a free-tier quota, and it keeps the hot path off
 * the SD card.
 */
export function createLimiter(limits = {}) {
  const cfg = { ...DEFAULT_LIMITS, ...limits };
  let stamps = []; // timestamps of granted calls, pruned to the last hour

  return {
    /**
     * Try to consume one slot at `now`. Grants record themselves; refusals
     * report why and when to retry.
     * @returns {{ ok:true } | { ok:false, reason:'cooldown'|'hourly', retryAfterMs:number }}
     */
    take(now) {
      stamps = stamps.filter((t) => now - t < 3_600_000);
      const last = stamps[stamps.length - 1];
      if (last !== undefined && now - last < cfg.minIntervalMs) {
        return { ok: false, reason: 'cooldown', retryAfterMs: cfg.minIntervalMs - (now - last) };
      }
      if (stamps.length >= cfg.maxPerHour) {
        // The oldest stamp aging out frees the next slot.
        return { ok: false, reason: 'hourly', retryAfterMs: stamps[0] + 3_600_000 - now };
      }
      stamps.push(now);
      return { ok: true };
    },

    /** Usage snapshot for a status display. */
    usage(now) {
      stamps = stamps.filter((t) => now - t < 3_600_000);
      return { usedThisHour: stamps.length, maxPerHour: cfg.maxPerHour };
    },
  };
}

/** Human wait time: "8s" / "12m". Rounds up so the advice is never too early. */
export function humanWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.ceil(s / 60)}m`;
}
