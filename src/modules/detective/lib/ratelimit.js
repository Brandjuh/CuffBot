// Pure, GLOBAL rate limiting for AI calls — no discord.js imports, no timers.
// Owner's spec (S16): the WHOLE server shares one budget — 1 AI message per
// 7 seconds AND at most 62 AI messages per rolling hour. Three people typing
// at once draw from the same single budget; there is no per-user allowance.
// The caller injects `now` everywhere, so every rule is unit-testable.

export const DEFAULT_LIMITS = {
  minIntervalMs: 7_000, // at most one AI message per 7 seconds, server-wide
  maxPerHour: 62, // at most 62 AI messages per rolling hour, server-wide
  // Provider free tiers also cap requests per DAY (owner's Gemini dashboard,
  // 2026-07-24: 20/day). null = no daily cap. The effective value comes from
  // the provider/env at call time via take()'s overrides.
  maxPerDay: null,
};

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Create a global limiter. State lives in memory: a restart forgets at most
 * one hour of history, which can only make the limiter briefly MORE generous —
 * acceptable for protecting a free-tier quota, and it keeps the hot path off
 * the SD card.
 */
export function createLimiter(limits = {}) {
  const cfg = { ...DEFAULT_LIMITS, ...limits };
  let stamps = []; // timestamps of granted calls, pruned to the last 24 h

  const withinHour = (now) => stamps.filter((t) => now - t < HOUR_MS);

  return {
    /**
     * Try to consume one slot at `now`. Grants record themselves; refusals
     * report why and when to retry. `overrides` supplies call-time limits
     * (e.g. the active provider's daily cap).
     * @returns {{ ok:true } | { ok:false, reason:'cooldown'|'hourly'|'daily', retryAfterMs:number }}
     */
    take(now, overrides = {}) {
      const eff = { ...cfg, ...overrides };
      stamps = stamps.filter((t) => now - t < DAY_MS);
      const last = stamps[stamps.length - 1];
      if (last !== undefined && now - last < eff.minIntervalMs) {
        return { ok: false, reason: 'cooldown', retryAfterMs: eff.minIntervalMs - (now - last) };
      }
      const hour = withinHour(now);
      if (hour.length >= eff.maxPerHour) {
        // The oldest in-window stamp aging out frees the next slot.
        return { ok: false, reason: 'hourly', retryAfterMs: hour[0] + HOUR_MS - now };
      }
      if (eff.maxPerDay != null && stamps.length >= eff.maxPerDay) {
        return { ok: false, reason: 'daily', retryAfterMs: stamps[0] + DAY_MS - now };
      }
      stamps.push(now);
      return { ok: true };
    },

    /** Usage snapshot for a status display. */
    usage(now, overrides = {}) {
      const eff = { ...cfg, ...overrides };
      stamps = stamps.filter((t) => now - t < DAY_MS);
      return {
        usedThisHour: withinHour(now).length,
        maxPerHour: eff.maxPerHour,
        usedToday: stamps.length,
        maxPerDay: eff.maxPerDay ?? null,
      };
    },
  };
}

/** Human wait time: "8s" / "12m". Rounds up so the advice is never too early. */
export function humanWait(ms) {
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.ceil(s / 60)}m`;
}
