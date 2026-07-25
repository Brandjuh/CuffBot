// City service (S90 = M16.13 slice B): the per-member criminal record the
// slice-A resolver runs on, the cog's gates, and the economy seam.
//
// The store keeps what the cog's DEFAULT_MEMBER kept, minus the display-only
// fields; guild-level knobs live under `citySettings` (the cog's
// global_settings) so slice D's admin surface has somewhere to write.
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { CRIMES, DEFAULT_CITY_SETTINGS } from './lib/tables.js';
import { bailCost, crimeCooldownLeft, defaultRng, jailLeft, resolveCrime } from './lib/resolve.js';
import { failedBreakExtension, pickPrisonBreak, pickScenario, resolveJailbreak, scenarioToCrime } from './lib/scenarios.js';

export const CITY_MEMBERS_KEY = 'cityMembers';
export const CITY_SETTINGS_KEY = 'citySettings';

const emptyMember = () => ({
  cooldowns: {}, // { crimeType: startedAt }
  jailMs: 0,
  jailStartedAt: 0,
  attemptedJailbreak: false, // slice C
  streak: 0,
  highest: 0,
  lastCrimeAt: 0,
  stats: {
    successes: 0,
    failures: 0,
    finesPaid: 0,
    earned: 0,
    largestHeist: 0,
    stolenFrom: 0, // taken from other members
    stolenBy: 0, // taken off this member
    bailPaid: 0,
  },
});

export function getCitySettings(guildId) {
  return { ...DEFAULT_CITY_SETTINGS, ...getGuildData(guildId, CITY_SETTINGS_KEY, {}) };
}

export function setCitySettings(guildId, patch) {
  const stored = { ...getGuildData(guildId, CITY_SETTINGS_KEY, {}), ...patch };
  setGuildData(guildId, CITY_SETTINGS_KEY, stored);
  return { ...DEFAULT_CITY_SETTINGS, ...stored };
}

export function getCriminal(guildId, userId) {
  const raw = getGuildData(guildId, CITY_MEMBERS_KEY, {})[userId] ?? {};
  return {
    ...emptyMember(),
    ...raw,
    cooldowns: { ...(raw.cooldowns ?? {}) },
    stats: { ...emptyMember().stats, ...(raw.stats ?? {}) },
  };
}

export function updateCriminal(guildId, userId, mutate) {
  let result;
  updateGuildData(
    guildId,
    CITY_MEMBERS_KEY,
    (all) => {
      result = mutate(getCriminal(guildId, userId)) ?? getCriminal(guildId, userId);
      return { ...all, [userId]: result };
    },
    {},
  );
  return result;
}

export const allCriminals = (guildId) => getGuildData(guildId, CITY_MEMBERS_KEY, {});

/** Test seam. */
export function resetCity(guildId) {
  setGuildData(guildId, CITY_MEMBERS_KEY, {});
  setGuildData(guildId, CITY_SETTINGS_KEY, {});
}

// ── the economy seam (S8: degrade, never block) ──────────────────────────────

export async function cityBalance(guildId, userId) {
  try {
    const { balanceOf } = await import('../economy/service.js');
    return balanceOf(guildId, userId);
  } catch (error) {
    logger.warn('City: balance lookup failed:', error?.message ?? error);
    return 0;
  }
}

export async function cityAdjustBalance(guildId, userId, delta) {
  if (!delta) return true;
  try {
    const { adjustBalance } = await import('../economy/service.js');
    adjustBalance(guildId, userId, delta);
    return true;
  } catch (error) {
    logger.warn('City: balance adjustment failed:', error?.message ?? error);
    return false;
  }
}

// ── gates ────────────────────────────────────────────────────────────────────

/** @returns {{jailed:false}|{jailed:true, remainingMs:number, releaseAt:number}} */
export function jailState(criminal, now = Date.now()) {
  const remainingMs = jailLeft(criminal, now);
  if (remainingMs <= 0) return { jailed: false };
  return { jailed: true, remainingMs, releaseAt: criminal.jailStartedAt + criminal.jailMs };
}

export function cooldownFor(criminal, crimeType, now = Date.now()) {
  return crimeCooldownLeft(criminal.cooldowns, crimeType, now);
}

/**
 * Everything that must be true before a crime may be attempted, in the cog's
 * order. `targetBalance` is only consulted for a targeted crime.
 * @returns {{ok:true}|{ok:false, reason:string, ...}}
 */
export function canAttempt(guildId, criminal, crimeType, { now = Date.now(), target = null, targetBalance = 0 } = {}) {
  const crime = CRIMES[crimeType];
  if (!crime) return { ok: false, reason: 'unknown-crime' };

  const jail = jailState(criminal, now);
  if (jail.jailed) return { ok: false, reason: 'jailed', ...jail };

  const cooldown = cooldownFor(criminal, crimeType, now);
  if (cooldown > 0) return { ok: false, reason: 'cooldown', remainingMs: cooldown };

  if (crime.requiresTarget) {
    if (!target) return { ok: false, reason: 'target-required' };
    if (target.self) return { ok: false, reason: 'target-self' };
    if (target.bot) return { ok: false, reason: 'target-bot' };
    // The cog refuses to rob someone who has too little to be worth robbing.
    const settings = getCitySettings(guildId);
    const minimum = Math.max(settings.minStealBalance, crime.minReward);
    if (targetBalance < minimum) return { ok: false, reason: 'target-too-poor', minimum };
  }
  return { ok: true };
}

// ── committing a crime ───────────────────────────────────────────────────────

/**
 * Run one attempt end to end: resolve it, move the money, write the record.
 * The caller has already cleared `canAttempt`.
 *
 * @returns {Promise<object>} the resolver outcome plus what was actually paid
 */
export async function commitCrime(
  guildId,
  userId,
  crimeType,
  { targetId = null, now = Date.now(), rng = defaultRng, crimeOverride = null } = {},
) {
  const crime = crimeOverride ?? CRIMES[crimeType];
  const criminal = getCriminal(guildId, userId);
  const settings = getCitySettings(guildId);
  const balance = await cityBalance(guildId, userId);
  const targetBalance = targetId ? await cityBalance(guildId, targetId) : 0;

  const outcome = resolveCrime(
    { crimeType, crime, member: { ...criminal, balance }, targetBalance, settings, now },
    rng,
  );

  // A steal can never take more than the victim actually holds.
  const takenFromTarget = Math.min(outcome.stolenFromTarget, targetBalance);
  const shortfall = outcome.stolenFromTarget - takenFromTarget;
  const payout = outcome.success ? outcome.payout - shortfall : outcome.payout;

  if (targetId && takenFromTarget > 0) {
    await cityAdjustBalance(guildId, targetId, -takenFromTarget);
    updateCriminal(guildId, targetId, (victim) => ({
      ...victim,
      stats: { ...victim.stats, stolenBy: victim.stats.stolenBy + takenFromTarget },
    }));
  }

  const netForCrook = outcome.success ? payout : payout - outcome.finePaid;
  await cityAdjustBalance(guildId, userId, netForCrook);

  updateCriminal(guildId, userId, (current) => ({
    ...current,
    cooldowns: { ...current.cooldowns, [crimeType]: now },
    lastCrimeAt: now,
    streak: outcome.streak.streak,
    highest: outcome.streak.highest,
    jailMs: outcome.success ? current.jailMs : outcome.jailMs,
    jailStartedAt: outcome.success ? current.jailStartedAt : now,
    stats: {
      ...current.stats,
      successes: current.stats.successes + (outcome.success ? 1 : 0),
      failures: current.stats.failures + (outcome.success ? 0 : 1),
      finesPaid: current.stats.finesPaid + (outcome.success ? 0 : outcome.finePaid),
      earned: current.stats.earned + (outcome.success ? Math.max(0, payout) : 0),
      largestHeist: outcome.success ? Math.max(current.stats.largestHeist, payout) : current.stats.largestHeist,
      stolenFrom: current.stats.stolenFrom + takenFromTarget,
    },
  }));

  return { ...outcome, payout, takenFromTarget, shortfall, netForCrook };
}

/** The leaderboard slice D will dress up; useful already for `!crime stats`. */
export function topCriminals(guildId, key = 'earned') {
  return Object.entries(allCriminals(guildId))
    .map(([id, raw]) => ({ id, ...getCriminal(guildId, id), _raw: raw }))
    .sort((a, b) => (b.stats[key] ?? 0) - (a.stats[key] ?? 0));
}

// ── jail: bail, jailbreak, and the scenario crime (S91 = slice C) ────────────

/**
 * Buy your way out. The payer is always the jailed member themselves (the cog
 * has no bail-for-a-friend on this side), and the cost tracks what is LEFT of
 * the sentence, so waiting it out gets cheaper.
 * @returns {Promise<{ok:true, cost:number}|{ok:false, error:string, ...}>}
 */
export async function payCityBail(guildId, userId, { now = Date.now() } = {}) {
  const settings = getCitySettings(guildId);
  if (!settings.allowBail) return { ok: false, error: 'bail-disabled' };
  const criminal = getCriminal(guildId, userId);
  const jail = jailState(criminal, now);
  if (!jail.jailed) return { ok: false, error: 'not-jailed' };

  const cost = bailCost(jail.remainingMs, settings);
  const balance = await cityBalance(guildId, userId);
  if (balance < cost) return { ok: false, error: 'too-poor', cost, balance };

  await cityAdjustBalance(guildId, userId, -cost);
  updateCriminal(guildId, userId, (current) => ({
    ...current,
    jailMs: 0,
    jailStartedAt: 0,
    attemptedJailbreak: false,
    stats: { ...current.stats, bailPaid: current.stats.bailPaid + cost },
  }));
  return { ok: true, cost, remainingMs: jail.remainingMs };
}

/**
 * Try to break out — once per sentence. A drawn scenario's events all apply
 * (they shift the odds and can cost or pay a little), then one roll decides:
 * out clean, or 30% added to whatever was left.
 */
export async function attemptJailbreak(guildId, userId, { now = Date.now(), rng = defaultRng } = {}) {
  const criminal = getCriminal(guildId, userId);
  const jail = jailState(criminal, now);
  if (!jail.jailed) return { ok: false, error: 'not-jailed' };
  if (criminal.attemptedJailbreak) return { ok: false, error: 'already-tried' };

  // Claim the one attempt before anything can go wrong (the S22 rule).
  updateCriminal(guildId, userId, (current) => ({ ...current, attemptedJailbreak: true }));

  const scenario = pickPrisonBreak(rng);
  const result = resolveJailbreak(scenario, rng);
  if (result.currencyChange !== 0) await cityAdjustBalance(guildId, userId, result.currencyChange);

  if (result.success) {
    updateCriminal(guildId, userId, (current) => ({ ...current, jailMs: 0, jailStartedAt: 0 }));
    return { ok: true, scenario, ...result, addedMs: 0, remainingMs: 0 };
  }

  const addedMs = failedBreakExtension(jail.remainingMs);
  updateCriminal(guildId, userId, (current) => ({
    ...current,
    jailStartedAt: now,
    jailMs: jail.remainingMs + addedMs,
  }));
  return { ok: true, scenario, ...result, addedMs, remainingMs: jail.remainingMs + addedMs };
}

/**
 * The scenario crime: draw one of the 46, let it override the `random`
 * crime's numbers, then run the normal pipeline through `commitCrime`.
 */
export async function commitScenarioCrime(guildId, userId, { now = Date.now(), rng = defaultRng } = {}) {
  const scenario = pickScenario(rng);
  const outcome = await commitCrime(guildId, userId, 'random', { now, rng, crimeOverride: scenarioToCrime(scenario) });
  return { ...outcome, scenario };
}
