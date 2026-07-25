// Economy service: donut balances in the guild store, activity earnings, the
// pot, /steal, and /daily. Pure rules live in lib/bank.js. The crook hunt
// moved to the hunting module in S66 (M16.1) — it spends and pays donuts
// through adjustBalance/addToPot like every other game (cross-module seam,
// always wrapped in try/catch by the caller).
import { getGuildData, updateGuildData } from '../../core/store.js';
import {
  CLAIM_INTERVALS,
  DEFAULT_ECONOMY_CONFIG,
  dayString,
  daysBetween,
  earnGain,
  evaluateClaim,
  heistSucceeds,
  potTryWins,
} from './lib/bank.js';

export const ECONOMY_CONFIG_KEY = 'economyConfig';
export const ECONOMY_USERS_KEY = 'economyUsers';

// Birthday gift (S38 owner request): announced alongside the birthday message.
export const BIRTHDAY_BONUS = 50_000;

export function getEconomyConfig(guildId) {
  return { ...DEFAULT_ECONOMY_CONFIG, ...getGuildData(guildId, ECONOMY_CONFIG_KEY, {}) };
}

export function setEconomyConfig(guildId, patch) {
  let stored;
  updateGuildData(guildId, ECONOMY_CONFIG_KEY, (current) => (stored = { ...current, ...patch }), {});
  return { ...DEFAULT_ECONOMY_CONFIG, ...stored };
}

export function getAccounts(guildId) {
  return getGuildData(guildId, ECONOMY_USERS_KEY, {});
}

/**
 * A member's balance. Everyone implicitly starts at `startingBalance` (10k) —
 * the record materializes in the store only on the first WRITE, so merely
 * checking a balance never grows the file.
 */
export function balanceOf(guildId, userId) {
  const rec = getAccounts(guildId)[userId];
  return rec ? rec.balance : getEconomyConfig(guildId).startingBalance;
}

/**
 * Adjust a member's donuts by `delta` (negative to take). Balances never go
 * below 0 — the crook can only steal what someone has.
 * @returns {{balance:number, applied:number}} new balance + what actually moved
 */
export function adjustBalance(guildId, userId, delta) {
  const starting = getEconomyConfig(guildId).startingBalance;
  let out;
  updateGuildData(
    guildId,
    ECONOMY_USERS_KEY,
    (accounts) => {
      const rec = accounts[userId] ?? { balance: starting, lastEarnAt: null };
      const next = Math.max(0, rec.balance + delta);
      out = { balance: next, applied: next - rec.balance };
      return { ...accounts, [userId]: { ...rec, balance: next } };
    },
    {},
  );
  return out;
}

/** Award activity donuts for a message (cooldown-gated; read-only fast path). */
export function awardActivity(guildId, userId, now) {
  const config = getEconomyConfig(guildId);
  const existing = getAccounts(guildId)[userId];
  if (existing && earnGain(config, existing.lastEarnAt, now) === 0) {
    return { gained: 0, balance: existing.balance };
  }
  let out;
  updateGuildData(
    guildId,
    ECONOMY_USERS_KEY,
    (accounts) => {
      const rec = accounts[userId] ?? { balance: config.startingBalance, lastEarnAt: null };
      const gain = earnGain(config, rec.lastEarnAt, now);
      const next = gain > 0 ? { ...rec, balance: rec.balance + gain, lastEarnAt: now } : rec;
      out = { gained: gain, balance: next.balance };
      return { ...accounts, [userId]: next };
    },
    {},
  );
  return out;
}

// ── payday-style claims (S67 = M16.2) ────────────────────────────────────────

const claimAmountKey = (key) => `claim${key[0].toUpperCase()}${key.slice(1)}`;

/** A member's last-claim timestamp for an interval (legacy lastDailyAt counts as `day`). */
function lastClaimAt(rec, key) {
  const stamped = rec?.claims?.[key] ?? null;
  if (stamped != null) return stamped;
  return key === 'day' ? (rec?.lastDailyAt ?? null) : null;
}

/**
 * Evaluate one interval for a member without claiming (for the /claims view).
 * @returns {{code:'off'|'disabled'}|{code:'cooldown', waitMs}|{code:'claim', amount, bonus}}
 */
export function peekClaim(guildId, userId, key, { now = Date.now() } = {}) {
  const config = getEconomyConfig(guildId);
  if (!config.enabled) return { code: 'disabled' };
  const interval = CLAIM_INTERVALS.find((i) => i.key === key);
  if (!interval) return { code: 'off' };
  return evaluateClaim({
    amount: config[claimAmountKey(key)],
    streakBonus: config.streakBonus,
    streakPercent: config.streakPercent,
    lastClaimAt: lastClaimAt(getAccounts(guildId)[userId], key),
    now,
    hours: interval.hours,
  });
}

/**
 * Claim one interval: stamp + award in one store write.
 * @returns {{code:'disabled'|'off'|'cooldown'|'claimed', amount?, bonus?, balance?, waitMs?}}
 */
export function claimInterval(guildId, userId, key, { now = Date.now() } = {}) {
  const verdict = peekClaim(guildId, userId, key, { now });
  if (verdict.code !== 'claim') return verdict.code === 'cooldown' ? verdict : { code: verdict.code };
  const config = getEconomyConfig(guildId);
  let out;
  updateGuildData(
    guildId,
    ECONOMY_USERS_KEY,
    (accounts) => {
      const rec = accounts[userId] ?? { balance: config.startingBalance, lastEarnAt: null };
      const balance = rec.balance + verdict.amount + verdict.bonus;
      out = { code: 'claimed', amount: verdict.amount, bonus: verdict.bonus, balance };
      const claims = { ...(rec.claims ?? {}), [key]: now };
      return { ...accounts, [userId]: { ...rec, balance, claims } };
    },
    {},
  );
  return out;
}

/** Claim every available interval at once (the cog's `freecredits all`). */
export function claimAll(guildId, userId, { now = Date.now() } = {}) {
  const results = [];
  for (const interval of CLAIM_INTERVALS) {
    const result = claimInterval(guildId, userId, interval.key, { now });
    if (result.code === 'claimed') results.push({ key: interval.key, ...result });
  }
  return {
    claimed: results,
    total: results.reduce((n, r) => n + r.amount, 0),
    totalBonus: results.reduce((n, r) => n + r.bonus, 0),
  };
}

/**
 * The /daily ration (S49, engine swapped in S67): the `day` interval claim.
 * Same outward shape as before; streak bonuses now apply when configured.
 */
export function claimDaily(guildId, userId, { now = Date.now() } = {}) {
  const result = claimInterval(guildId, userId, 'day', { now });
  if (result.code === 'off') return { code: 'disabled' }; // day amount set to 0 = feature off
  return result;
}

/**
 * Birthday seam (called by the birthdays module, wrapped there): gift the
 * birthday member their donuts. Returns the amount granted, or null when the
 * economy is disabled (so the announcement can skip the donut line honestly).
 */
export function grantBirthdayBonus(guildId, userId) {
  const config = getEconomyConfig(guildId);
  if (!config.enabled) return null;
  adjustBalance(guildId, userId, BIRTHDAY_BONUS);
  return BIRTHDAY_BONUS;
}

// ── the donut pot (S41) ──────────────────────────────────────────────────────
// Every donut the games take away lands in ONE pot: a busted /steal, the
// escaping crook's loot, and any future game's losses (call addToPot). The
// pot also grows 500/day on its own. Once a day each member may try to crack
// it (0.5%) — the winner takes everything. Day rollover: midnight UTC.

export const ECONOMY_POT_KEY = 'economyPot';

const freshPot = (config, today) => ({
  balance: config.potDailyTopUp,
  lastTopUpDay: today,
  attempts: {},
});

/** Read the pot, lazily applying the daily top-ups (500 per elapsed day). */
export function getPot(guildId, now = Date.now()) {
  const config = getEconomyConfig(guildId);
  const today = dayString(now);
  let pot;
  updateGuildData(
    guildId,
    ECONOMY_POT_KEY,
    (stored) => {
      if (!stored?.lastTopUpDay) return (pot = freshPot(config, today));
      const missedDays = daysBetween(stored.lastTopUpDay, today);
      if (missedDays === 0) return (pot = stored);
      return (pot = {
        ...stored,
        balance: stored.balance + missedDays * config.potDailyTopUp,
        lastTopUpDay: today,
      });
    },
    null,
  );
  return pot;
}

/** Drop donuts into the pot (games call this with their losses). */
export function addToPot(guildId, amount, now = Date.now()) {
  getPot(guildId, now); // ensure today's top-up landed first
  let balance;
  updateGuildData(
    guildId,
    ECONOMY_POT_KEY,
    (stored) => {
      const next = { ...stored, balance: stored.balance + Math.max(0, amount) };
      balance = next.balance;
      return next;
    },
    null,
  );
  return balance;
}

/**
 * One daily attempt to crack the pot open. Win (0.5%): the whole pot moves to
 * the member and it resets to 0 (tomorrow's 500 keeps it seeded). Lose: the
 * pot keeps everything. Either way the member's attempt for today is spent.
 * @returns {{code:'disabled'|'already'|'win'|'lose', amount?:number, balance?:number}}
 */
/** Has this member used today's pot attempt already? (read-only, for /pot) */
export function hasPotTryToday(guildId, userId, now = Date.now()) {
  return getPot(guildId, now).attempts?.[userId] === dayString(now);
}

export function tryPot(guildId, userId, { random = Math.random, now = Date.now() } = {}) {
  const config = getEconomyConfig(guildId);
  if (!config.enabled) return { code: 'disabled' };
  const today = dayString(now);
  const pot = getPot(guildId, now);
  if (pot.attempts?.[userId] === today) return { code: 'already' };

  const win = potTryWins(config, random);
  let amount = 0;
  updateGuildData(
    guildId,
    ECONOMY_POT_KEY,
    (stored) => {
      const attempts = { ...stored.attempts, [userId]: today };
      if (!win) return { ...stored, attempts };
      amount = stored.balance;
      return { ...stored, balance: 0, attempts };
    },
    null,
  );
  if (win) {
    if (amount > 0) adjustBalance(guildId, userId, amount);
    return { code: 'win', amount };
  }
  return { code: 'lose', balance: pot.balance };
}

/**
 * One /steal attempt (S40, revised S41): 30% success moves the loot from the
 * target to the thief; a busted attempt drops the thief's donuts INTO THE
 * DONUT POT. Amounts are capped by what the payer actually has (balances
 * floor at 0), reported honestly via `amount`.
 * @returns {{code:'disabled'|'self'|'cooldown'|'success'|'failure',
 *            amount?:number, waitMs?:number, potBalance?:number}}
 */
export function attemptHeist(guild, thiefId, targetId, { random = Math.random, now = Date.now() } = {}) {
  const guildId = guild.id;
  const config = getEconomyConfig(guildId);
  if (!config.enabled) return { code: 'disabled' };
  if (thiefId === targetId) return { code: 'self' };

  const lastHeistAt = getAccounts(guildId)[thiefId]?.lastHeistAt ?? null;
  const cooldown = config.heistCooldownMs;
  if (lastHeistAt && now - lastHeistAt < cooldown) {
    return { code: 'cooldown', waitMs: cooldown - (now - lastHeistAt) };
  }
  updateGuildData(
    guildId,
    ECONOMY_USERS_KEY,
    (accounts) => {
      const rec = accounts[thiefId] ?? { balance: config.startingBalance, lastEarnAt: null };
      return { ...accounts, [thiefId]: { ...rec, lastHeistAt: now } };
    },
    {},
  );

  if (heistSucceeds(config, random)) {
    const { applied } = adjustBalance(guildId, targetId, -config.heistAmount);
    const loot = Math.abs(applied);
    if (loot > 0) adjustBalance(guildId, thiefId, loot);
    return { code: 'success', amount: loot };
  }
  const { applied } = adjustBalance(guildId, thiefId, -config.heistAmount);
  const seized = Math.abs(applied);
  const potBalance = seized > 0 ? addToPot(guildId, seized, now) : getPot(guildId, now).balance;
  return { code: 'failure', amount: seized, potBalance };
}

/** Top balances: [{userId, balance}], richest first. */
export function topBalances(guildId, limit = 10) {
  const max = Math.max(1, Math.min(25, Number.isFinite(limit) ? limit : 10));
  return Object.entries(getAccounts(guildId))
    .map(([userId, rec]) => ({ userId, balance: rec.balance }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, max);
}
