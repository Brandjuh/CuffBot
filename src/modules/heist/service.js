// Heist service (S86 = M16.12 slice B): the per-member state the slice-A
// rules engine operates on, plus the gates the cog checks before every
// action (jail → debt → active job → cooldown) and the economy seam.
//
// Deviation from the cog worth knowing: heat decay is COMPUTED at read time
// from (heat, heatLastSet) instead of being written back on every read. The
// schedule is identical — one point per two idle hours — but it costs the
// Pi's SD card nothing and no longer depends on how often someone looks.
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { HEISTS, ITEMS } from './lib/tables.js';
import { craftPlan } from './lib/crafting.js';
import { bailTotal, decayedHeat, defaultRng, resolveHeist } from './lib/resolve.js';

export const HEIST_PLAYERS_KEY = 'heistPlayers';

export const CREW_LEVEL_REQUIREMENT = 20; // the cog's gate for crew_robbery (slice D)

const emptyPlayer = () => ({
  inventory: {},
  equipped: { shield: null, tool: null },
  heat: 0,
  heatLastSet: null,
  materialHeat: 0,
  debt: 0,
  jail: null, // { endsAt, bail }
  xp: 0,
  stats: { success: 0, fail: 0, caught: 0 },
  cooldowns: {}, // { heistType: startedAt }
  activeHeist: null, // { type, endsAt, channelId, taxAgreed }
});

/** The stored player, normalized, with heat already decayed for `now`. */
export function getPlayer(guildId, userId, now = Date.now()) {
  const raw = getGuildData(guildId, HEIST_PLAYERS_KEY, {})[userId] ?? {};
  const player = {
    ...emptyPlayer(),
    ...raw,
    equipped: { shield: null, tool: null, ...(raw.equipped ?? {}) },
    inventory: { ...(raw.inventory ?? {}) },
    stats: { success: 0, fail: 0, caught: 0, ...(raw.stats ?? {}) },
    cooldowns: { ...(raw.cooldowns ?? {}) },
  };
  player.heat = decayedHeat(player.heat, player.heatLastSet, now);
  return player;
}

export function savePlayer(guildId, userId, player) {
  updateGuildData(guildId, HEIST_PLAYERS_KEY, (all) => ({ ...all, [userId]: player }), {});
}

/** Read-modify-write helper: the mutator receives the normalized player. */
export function updatePlayer(guildId, userId, mutate, now = Date.now()) {
  let result;
  updateGuildData(
    guildId,
    HEIST_PLAYERS_KEY,
    (all) => {
      const current = getPlayer(guildId, userId, now);
      result = mutate(current) ?? current;
      return { ...all, [userId]: result };
    },
    {},
  );
  return result;
}

export function allPlayers(guildId) {
  return getGuildData(guildId, HEIST_PLAYERS_KEY, {});
}

/** Test seam. */
export function resetHeistPlayers(guildId) {
  setGuildData(guildId, HEIST_PLAYERS_KEY, {});
}

// ── the economy seam (S8: a broken economy degrades, never blocks) ───────────

export async function heistBalance(guildId, userId) {
  try {
    const { balanceOf } = await import('../economy/service.js');
    return balanceOf(guildId, userId);
  } catch (error) {
    logger.warn('Heist: balance lookup failed:', error?.message ?? error);
    return 0;
  }
}

export async function heistAdjustBalance(guildId, userId, delta) {
  if (!delta) return true;
  try {
    const { adjustBalance } = await import('../economy/service.js');
    adjustBalance(guildId, userId, delta);
    return true;
  } catch (error) {
    logger.warn('Heist: balance adjustment failed:', error?.message ?? error);
    return false;
  }
}

// ── gates ────────────────────────────────────────────────────────────────────

/** @returns {{jailed:false} | {jailed:true, endsAt:number, bail:number, total:number}} */
export function jailStatus(player, now = Date.now()) {
  if (!player.jail || now >= player.jail.endsAt) return { jailed: false };
  return {
    jailed: true,
    endsAt: player.jail.endsAt,
    bail: player.jail.bail,
    total: bailTotal(player.jail.bail),
  };
}

/** Milliseconds left on a job's cooldown (0 = ready). */
export function cooldownLeft(player, heistType, now = Date.now()) {
  const startedAt = player.cooldowns[heistType];
  if (!startedAt) return 0;
  const cooldownMs = HEISTS[heistType]?.cooldownMs ?? 0;
  return Math.max(0, startedAt + cooldownMs - now);
}

/** Jobs a player can start right now (crew jobs are slice D, excluded here). */
export function readyJobs(player, now = Date.now()) {
  return Object.keys(HEISTS).filter((type) => !HEISTS[type].crewSize && cooldownLeft(player, type, now) === 0);
}

// ── running a job ────────────────────────────────────────────────────────────

/**
 * Start a job: stamps the cooldown and the active-heist record. The caller
 * has already cleared the gates.
 */
export function startHeist(guildId, userId, heistType, channelId, { taxAgreed = false, now = Date.now() } = {}) {
  const heist = HEISTS[heistType];
  const endsAt = now + heist.durationMs;
  updatePlayer(
    guildId,
    userId,
    (player) => ({
      ...player,
      cooldowns: { ...player.cooldowns, [heistType]: now },
      activeHeist: { type: heistType, endsAt, channelId, taxAgreed },
    }),
    now,
  );
  return { endsAt };
}

/**
 * Resolve the player's active job through the pure engine, apply the state
 * and pay the balance delta. Returns null when there is nothing to settle
 * (no active job, or it is still running).
 *
 * Slice B calls this LAZILY — the next heist command a player runs settles a
 * finished job, exactly like the cog's own fallback. Slice C adds the timer
 * that announces it on its own.
 */
export async function settleActiveHeist(guildId, userId, { now = Date.now(), rng = defaultRng, force = false } = {}) {
  const player = getPlayer(guildId, userId, now);
  const active = player.activeHeist;
  if (!active) return null;
  if (!force && now < active.endsAt) return null;
  const heist = HEISTS[active.type];
  if (!heist) {
    updatePlayer(guildId, userId, (p) => ({ ...p, activeHeist: null }), now);
    return null;
  }

  const balance = await heistBalance(guildId, userId);
  const outcome = resolveHeist(
    {
      heistType: active.type,
      heist,
      player,
      balance,
      taxAgreed: active.taxAgreed ?? false,
      now,
    },
    rng,
  );

  const paid = await heistAdjustBalance(guildId, userId, outcome.balanceDelta);
  updatePlayer(
    guildId,
    userId,
    (current) => ({
      ...current,
      ...outcome.nextState,
      // Keep the cooldown map and clear the finished job.
      cooldowns: current.cooldowns,
      jail: outcome.jail ? { endsAt: outcome.jail.endsAt, bail: outcome.jail.bail } : current.jail,
      activeHeist: null,
    }),
    now,
  );
  return { ...outcome, channelId: active.channelId, paid };
}

// ── shop, inventory, crafting, jail ──────────────────────────────────────────

export const shopItems = () =>
  Object.entries(ITEMS)
    .filter(([, item]) => typeof item.cost === 'number')
    .map(([id, item]) => ({ id, ...item }));

/** @returns {Promise<{ok:true, cost:number}|{ok:false, error:string, need?:number, have?:number}>} */
export async function buyItem(guildId, userId, itemId, amount = 1, now = Date.now()) {
  const item = ITEMS[itemId];
  if (!item || typeof item.cost !== 'number') return { ok: false, error: 'not-for-sale' };
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) return { ok: false, error: 'bad-amount' };
  const cost = item.cost * amount;
  const balance = await heistBalance(guildId, userId);
  if (balance < cost) return { ok: false, error: 'poor', need: cost, have: balance };
  await heistAdjustBalance(guildId, userId, -cost);
  updatePlayer(
    guildId,
    userId,
    (player) => ({
      ...player,
      inventory: { ...player.inventory, [itemId]: (player.inventory[itemId] ?? 0) + amount },
    }),
    now,
  );
  return { ok: true, cost };
}

/** @returns {Promise<{ok:true, amount:number, price:number}|{ok:false, error:string}>} */
export async function sellItem(guildId, userId, itemId, amount = 1, { now = Date.now(), rng = defaultRng } = {}) {
  const item = ITEMS[itemId];
  if (!item || (item.type !== 'loot' && item.type !== 'material')) return { ok: false, error: 'not-sellable' };
  if (!Number.isInteger(amount) || amount < 1) return { ok: false, error: 'bad-amount' };
  const player = getPlayer(guildId, userId, now);
  if ((player.inventory[itemId] ?? 0) < amount) return { ok: false, error: 'not-enough' };
  // The cog rolls a price PER unit and sums them.
  let price = 0;
  for (let i = 0; i < amount; i += 1) price += rng.int(item.minSell, item.maxSell);
  await heistAdjustBalance(guildId, userId, price);
  updatePlayer(
    guildId,
    userId,
    (current) => {
      const inventory = { ...current.inventory };
      const left = (inventory[itemId] ?? 0) - amount;
      if (left <= 0) delete inventory[itemId];
      else inventory[itemId] = left;
      return { ...current, inventory };
    },
    now,
  );
  return { ok: true, amount, price };
}

/** @returns {{ok:true, slot:string}|{ok:false, error:string}} */
export function equipItem(guildId, userId, itemId, now = Date.now()) {
  const item = ITEMS[itemId];
  if (!item) return { ok: false, error: 'unknown-item' };
  if (item.type !== 'shield' && item.type !== 'tool') return { ok: false, error: 'not-equippable' };
  const player = getPlayer(guildId, userId, now);
  if ((player.inventory[itemId] ?? 0) <= 0) return { ok: false, error: 'not-owned' };
  updatePlayer(guildId, userId, (current) => ({
    ...current,
    equipped: { ...current.equipped, [item.type]: itemId },
  }), now);
  return { ok: true, slot: item.type };
}

export function unequipSlot(guildId, userId, slot, now = Date.now()) {
  if (slot !== 'shield' && slot !== 'tool') return { ok: false, error: 'bad-slot' };
  updatePlayer(guildId, userId, (current) => ({
    ...current,
    equipped: { ...current.equipped, [slot]: null },
  }), now);
  return { ok: true };
}

/** @returns {{ok:true, result:string}|{ok:false, error:string, missing?:object}} */
export function craftItem(guildId, userId, recipeName, now = Date.now()) {
  const player = getPlayer(guildId, userId, now);
  const plan = craftPlan(player.inventory, recipeName);
  if (!plan.ok) return plan;
  updatePlayer(guildId, userId, (current) => ({ ...current, inventory: plan.inventory }), now);
  return { ok: true, result: plan.result, quantity: plan.quantity };
}

/**
 * Pay off debt — the cog pays whatever the balance covers.
 * @returns {Promise<{paid:number, remaining:number}>}
 */
export async function payDebt(guildId, userId, now = Date.now()) {
  const player = getPlayer(guildId, userId, now);
  if (player.debt <= 0) return { paid: 0, remaining: 0 };
  const balance = await heistBalance(guildId, userId);
  const paid = Math.min(balance, player.debt);
  if (paid > 0) await heistAdjustBalance(guildId, userId, -paid);
  const remaining = player.debt - paid;
  updatePlayer(guildId, userId, (current) => ({ ...current, debt: remaining }), now);
  return { paid, remaining };
}

/**
 * Bail someone out — the payer's balance settles it; the cog clears jail AND
 * both heat counters for the freed member.
 * @returns {Promise<{ok:true, total:number}|{ok:false, error:string, need?:number, have?:number}>}
 */
export async function payBail(guildId, payerId, jailedId, now = Date.now()) {
  const jailed = getPlayer(guildId, jailedId, now);
  const status = jailStatus(jailed, now);
  if (!status.jailed) return { ok: false, error: 'not-jailed' };
  const balance = await heistBalance(guildId, payerId);
  if (balance < status.total) return { ok: false, error: 'poor', need: status.total, have: balance };
  await heistAdjustBalance(guildId, payerId, -status.total);
  updatePlayer(guildId, jailedId, (current) => ({ ...current, jail: null, heat: 0, materialHeat: 0, heatLastSet: now }), now);
  return { ok: true, total: status.total };
}
