// Pure donut-economy math — no discord.js. Balances, activity earnings, and
// the crook-hunt game rules (S38 owner request) live here as deterministic
// functions; every random draw takes an injectable `random` so tests can pin
// outcomes. The store and live Discord objects stay in service.js.

export const DEFAULT_ECONOMY_CONFIG = {
  enabled: true,
  startingBalance: 10_000, // owner: "iedereen begint met 10k donuts"
  earnPerMessage: 5, // activity pay (past the cooldown)
  earnCooldownMs: 60_000,
  huntEnabled: true,
  huntChance: 0.03, // spawn roll per eligible message in an active channel
  huntCooldownMs: 10 * 60_000, // per-channel gap between hunts
  huntActivityWindowMs: 3 * 60_000, // "active" = enough recent messages…
  huntActivityMin: 4, // …this many, from at least two humans
  huntMinDurationMs: 5_000, // owner: the crook stays 5–20 seconds
  huntMaxDurationMs: 20_000,
  catchRewardMin: 100,
  catchRewardMax: 300,
  stealMin: 50,
  stealMax: 250,
  heistChance: 0.3, // /steal success odds (owner: 30%)
  heistAmount: 500, // what a successful /steal moves victim → thief; a failed one feeds the pot
  heistCooldownMs: 3 * 60 * 60_000, // lay-low time per thief (S48 owner decision: 3 hours)
  potDailyTopUp: 500, // the pot grows by this every day (owner: S41)
  potWinChance: 0.005, // odds that a daily /pot try empties it (owner: 0.5%)
  dailyAmount: 25, // the /daily ration (S49 owner decision)
  dailyCooldownMs: 24 * 60 * 60_000, // one claim per rolling 24 hours
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

/** How long this crook lingers before fleeing (5–20 s by default). */
export function huntDurationMs(config, random = Math.random) {
  return randomInt(
    config.huntMinDurationMs ?? DEFAULT_ECONOMY_CONFIG.huntMinDurationMs,
    config.huntMaxDurationMs ?? DEFAULT_ECONOMY_CONFIG.huntMaxDurationMs,
    random,
  );
}

export function catchReward(config, random = Math.random) {
  return randomInt(
    config.catchRewardMin ?? DEFAULT_ECONOMY_CONFIG.catchRewardMin,
    config.catchRewardMax ?? DEFAULT_ECONOMY_CONFIG.catchRewardMax,
    random,
  );
}

export function stealAmount(config, random = Math.random) {
  return randomInt(
    config.stealMin ?? DEFAULT_ECONOMY_CONFIG.stealMin,
    config.stealMax ?? DEFAULT_ECONOMY_CONFIG.stealMax,
    random,
  );
}

/**
 * Channel-activity ring: track recent human messages per channel so hunts
 * only spawn where a conversation is actually happening. `state` is a plain
 * Map(channelId → [{userId, at}]) owned by the caller (RAM only).
 */
export function trackActivity(state, channelId, userId, now, config = DEFAULT_ECONOMY_CONFIG) {
  const windowMs = config.huntActivityWindowMs ?? DEFAULT_ECONOMY_CONFIG.huntActivityWindowMs;
  const list = (state.get(channelId) ?? []).filter((e) => now - e.at < windowMs);
  list.push({ userId, at: now });
  if (list.length > 50) list.splice(0, list.length - 50);
  state.set(channelId, list);
  return list;
}

/** Active = enough recent messages from at least two distinct humans. */
export function channelIsActive(state, channelId, now, config = DEFAULT_ECONOMY_CONFIG) {
  const windowMs = config.huntActivityWindowMs ?? DEFAULT_ECONOMY_CONFIG.huntActivityWindowMs;
  const min = config.huntActivityMin ?? DEFAULT_ECONOMY_CONFIG.huntActivityMin;
  const recent = (state.get(channelId) ?? []).filter((e) => now - e.at < windowMs);
  if (recent.length < min) return false;
  return new Set(recent.map((e) => e.userId)).size >= 2;
}

/**
 * Roll for a crook spawn: only in an active channel, past the per-channel
 * cooldown, and then with a small chance per message so hunts feel random.
 */
export function shouldSpawnHunt({ active, lastHuntAt, now, config, random = Math.random }) {
  if (!active) return false;
  const cooldown = config.huntCooldownMs ?? DEFAULT_ECONOMY_CONFIG.huntCooldownMs;
  if (lastHuntAt && now - lastHuntAt < cooldown) return false;
  return random() < (config.huntChance ?? DEFAULT_ECONOMY_CONFIG.huntChance);
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
