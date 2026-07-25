// Pure donut-economy math — no discord.js. Balances, activity earnings, the
// pot, and /steal live here as deterministic functions; every random draw
// takes an injectable `random` so tests can pin outcomes. isCatchPhrase,
// pickVictim, and randomInt are shared with the hunting module (S66 seam).

export const DEFAULT_ECONOMY_CONFIG = {
  enabled: true,
  startingBalance: 10_000, // owner: "iedereen begint met 10k donuts"
  earnPerMessage: 5, // activity pay (past the cooldown)
  earnCooldownMs: 60_000,
  heistChance: 0.3, // /steal success odds (owner: 30%)
  heistAmount: 500, // what a successful /steal moves victim → thief; a failed one feeds the pot
  heistCooldownMs: 3 * 60 * 60_000, // lay-low time per thief (S48 owner decision: 3 hours)
  potDailyTopUp: 500, // the pot grows by this every day (owner: S41)
  potWinChance: 0.005, // odds that a daily /pot try empties it (owner: 0.5%)
  // S67 (M16.2): payday-style claim amounts per interval, 0 = off. The day
  // claim carries the S49 daily ration forward.
  claimHour: 0,
  claimDay: 25,
  claimWeek: 0,
  claimMonth: 0,
  claimQuarter: 0,
  claimYear: 0,
  streakBonus: 0, // extra for claiming within [T, 2T) — 0 = streaks off
  streakPercent: false, // bonus = base × floor(streakBonus/100) instead of flat
};

/** "2 h 45 min" / "12 min" — shared by every cooldown refusal. */
export function formatWaitMs(ms) {
  const totalMinutes = Math.ceil(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours} h ${minutes} min` : `${minutes} min`;
}

/** Donuts to award for a message given the last-earn time. 0 within cooldown. */
export function earnGain(config, lastEarnAt, now) {
  const cooldown = config.earnCooldownMs ?? DEFAULT_ECONOMY_CONFIG.earnCooldownMs;
  if (lastEarnAt && now - lastEarnAt < cooldown) return 0;
  return config.earnPerMessage ?? DEFAULT_ECONOMY_CONFIG.earnPerMessage;
}

/** Integer in [min, max] from a [0,1) random draw. */
export function randomInt(min, max, random = Math.random) {
  const lo = Math.ceil(min);
  const hi = Math.floor(max);
  return lo + Math.floor(random() * (hi - lo + 1));
}

/**
 * Does this message catch the crook? The arrest phrase is "STOP POLICE" —
 * matched case-insensitively, ignoring punctuation/extra spaces, and allowing
 * trailing words ("STOP POLICE!!!", "stop police you crook"). Words BEFORE
 * the phrase do not count: the shout must lead the message.
 */
export function isCatchPhrase(content) {
  const letters = String(content ?? '')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  return letters.startsWith('STOPPOLICE');
}

/** Pick the crook's victim from candidate ids (never the catcher/nobody). */
export function pickVictim(candidateIds, random = Math.random) {
  if (!candidateIds || candidateIds.length === 0) return null;
  return candidateIds[Math.floor(random() * candidateIds.length)];
}

/** One /steal roll: strictly-below keeps the odds exactly at heistChance. */
export function heistSucceeds(config, random = Math.random) {
  return random() < (config.heistChance ?? DEFAULT_ECONOMY_CONFIG.heistChance);
}

/** One /pot try: 0.5% by default, strictly-below keeps the odds exact. */
export function potTryWins(config, random = Math.random) {
  return random() < (config.potWinChance ?? DEFAULT_ECONOMY_CONFIG.potWinChance);
}

/** The pot's "day" — a UTC date string; rollover at midnight UTC. */
export function dayString(now) {
  return new Date(now).toISOString().slice(0, 10);
}

/** Whole days between two dayString values (0 for the same day, never negative). */
export function daysBetween(fromDay, toDay) {
  const from = Date.parse(`${fromDay}T00:00:00Z`);
  const to = Date.parse(`${toDay}T00:00:00Z`);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

// ── payday-style claims (S67 = M16.2, ported from YamiCogs/payday) ───────────

/** The six claim intervals, hour-counts exactly as the cog defines them. */
export const CLAIM_INTERVALS = [
  { key: 'hour', hours: 1, label: 'Hourly' },
  { key: 'day', hours: 24, label: 'Daily' },
  { key: 'week', hours: 168, label: 'Weekly' },
  { key: 'month', hours: 720, label: 'Monthly' },
  { key: 'quarter', hours: 2184, label: 'Quarterly' },
  { key: 'year', hours: 8760, label: 'Yearly' },
];

/**
 * One claim evaluation, faithful to the cog's grant_award: elapsed < T →
 * cooldown with the exact wait; elapsed in [T, 2T) with a bonus configured →
 * base + streak bonus (percent mode: base × floor(bonus/100), the cog's
 * exact formula); elapsed ≥ 2T (or first claim ever) → base only.
 * @returns {{code:'off'}|{code:'cooldown', waitMs:number}|{code:'claim', amount:number, bonus:number}}
 */
export function evaluateClaim({ amount, streakBonus = 0, streakPercent = false, lastClaimAt = null, now, hours }) {
  if (!amount || amount <= 0) return { code: 'off' };
  if (lastClaimAt == null) return { code: 'claim', amount, bonus: 0 };
  const T = hours * 3_600_000;
  const elapsed = now - lastClaimAt;
  if (elapsed < T) return { code: 'cooldown', waitMs: T - elapsed };
  const onStreak = streakBonus > 0 && elapsed < 2 * T;
  const bonus = onStreak ? (streakPercent ? amount * Math.floor(streakBonus / 100) : streakBonus) : 0;
  return { code: 'claim', amount, bonus };
}
