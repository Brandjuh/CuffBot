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
import { bailTotal, decayedHeat, defaultRng, resolveCrewHeist, resolveHeist } from './lib/resolve.js';

export const HEIST_PLAYERS_KEY = 'heistPlayers';

export const CREW_LEVEL_REQUIREMENT = 20; // the cog's gate to ORGANISE a crew
export const CREW_SIZE = HEISTS.crew_robbery.crewSize; // 4
export const CREW_LOBBY_TIMEOUT_MS = 180_000; // the cog's LOBBY_TIMEOUT

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

/** Milliseconds left on a job's cooldown (0 = ready). Pass `cooldownMs` to
 * respect an admin override; omitting it uses the cog default. */
export function cooldownLeft(player, heistType, now = Date.now(), cooldownMs = null) {
  const startedAt = player.cooldowns[heistType];
  if (!startedAt) return 0;
  const window = cooldownMs ?? HEISTS[heistType]?.cooldownMs ?? 0;
  return Math.max(0, startedAt + window - now);
}

/** Solo jobs a player can start right now (crew robbery has its own lobby).
 * Pass `guildId` to measure against this precinct's tuned cooldowns. */
export function readyJobs(player, now = Date.now(), guildId = null) {
  return Object.keys(HEISTS).filter(
    (type) =>
      !HEISTS[type].crewSize &&
      cooldownLeft(player, type, now, guildId ? getHeistSettings(guildId, type).cooldownMs : null) === 0,
  );
}

// ── running a job ────────────────────────────────────────────────────────────

/**
 * Start a job: stamps the cooldown and the active-heist record. The caller
 * has already cleared the gates.
 */
export function startHeist(guildId, userId, heistType, channelId, { taxAgreed = false, now = Date.now() } = {}) {
  const heist = getHeistSettings(guildId, heistType);
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
  // A crew job belongs to its leader: one settlement covers all four, so a
  // member's own command delegates instead of resolving a second time.
  if (active.crew) {
    if (active.leader && active.leader !== userId) {
      return settleCrewHeist(guildId, active.leader, { now, rng });
    }
    return settleCrewHeist(guildId, userId, { now, rng });
  }
  const heist = getHeistSettings(guildId, active.type);
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
  const cost = getItemCost(guildId, itemId) * amount;
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

// ── admin-tunable job table + events (S88 = slice D) ─────────────────────────

export const HEIST_SETTINGS_KEY = 'heistSettings'; // { jobs: {type: {field: value}}, prices: {item: cost}, event: {multiplier, endsAt} }

/** Fields an admin may override, with the cog's `_PARAM_META` ranges. */
export const TUNABLE_FIELDS = {
  minReward: { label: 'Min reward', min: 0, max: 100_000_000 },
  maxReward: { label: 'Max reward', min: 0, max: 100_000_000 },
  minSuccess: { label: 'Min success %', min: 0, max: 100 },
  maxSuccess: { label: 'Max success %', min: 0, max: 100 },
  policeChance: { label: 'Police chance (0–1)', min: 0, max: 1, float: true },
  risk: { label: 'Risk (0–1)', min: 0, max: 1, float: true },
  cooldownMs: { label: 'Cooldown (seconds)', min: 0, max: 604_800, seconds: true },
  durationMs: { label: 'Duration (seconds)', min: 5, max: 86_400, seconds: true },
  jailMs: { label: 'Jail time (seconds)', min: 0, max: 604_800, seconds: true },
};

const rawSettings = (guildId) => getGuildData(guildId, HEIST_SETTINGS_KEY, {});

/** One job's live settings: the cog's defaults with this guild's overrides on top. */
export function getHeistSettings(guildId, heistType) {
  const base = HEISTS[heistType];
  if (!base) return null;
  return { ...base, ...(rawSettings(guildId).jobs?.[heistType] ?? {}) };
}

/** @returns {{ok:true, value:number}|{ok:false, error:string, min?:number, max?:number}} */
export function setHeistOverride(guildId, heistType, field, rawValue) {
  if (!HEISTS[heistType]) return { ok: false, error: 'unknown-job' };
  const spec = TUNABLE_FIELDS[field];
  if (!spec) return { ok: false, error: 'unknown-field' };
  const parsed = spec.float ? Number(rawValue) : Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) return { ok: false, error: 'not-a-number' };
  if (parsed < spec.min || parsed > spec.max) return { ok: false, error: 'out-of-range', min: spec.min, max: spec.max };
  // Time fields are typed in seconds and stored in milliseconds.
  const value = spec.seconds ? parsed * 1000 : parsed;
  updateGuildData(
    guildId,
    HEIST_SETTINGS_KEY,
    (all) => ({
      ...all,
      jobs: { ...(all.jobs ?? {}), [heistType]: { ...(all.jobs?.[heistType] ?? {}), [field]: value } },
    }),
    {},
  );
  return { ok: true, value };
}

/** Drop overrides for one job, or for every job when `heistType` is null. */
export function resetHeistOverrides(guildId, heistType = null) {
  let cleared = 0;
  updateGuildData(
    guildId,
    HEIST_SETTINGS_KEY,
    (all) => {
      const jobs = { ...(all.jobs ?? {}) };
      if (heistType) {
        cleared = jobs[heistType] ? Object.keys(jobs[heistType]).length : 0;
        delete jobs[heistType];
      } else {
        cleared = Object.values(jobs).reduce((n, fields) => n + Object.keys(fields).length, 0);
        for (const key of Object.keys(jobs)) delete jobs[key];
      }
      return { ...all, jobs };
    },
    {},
  );
  return cleared;
}

/** Every override currently in force, for the admin overview. */
export function listHeistOverrides(guildId) {
  return rawSettings(guildId).jobs ?? {};
}

/** An item's price with the guild's override applied (the cog's get_item_cost). */
export function getItemCost(guildId, itemId) {
  const override = rawSettings(guildId).prices?.[itemId];
  return typeof override === 'number' ? override : ITEMS[itemId]?.cost;
}

export function setItemPrice(guildId, itemId, cost) {
  const item = ITEMS[itemId];
  if (!item || typeof item.cost !== 'number') return { ok: false, error: 'not-for-sale' };
  if (!Number.isInteger(cost) || cost < 0 || cost > 10_000_000) return { ok: false, error: 'out-of-range' };
  updateGuildData(guildId, HEIST_SETTINGS_KEY, (all) => ({ ...all, prices: { ...(all.prices ?? {}), [itemId]: cost } }), {});
  return { ok: true, cost };
}

/**
 * The reward multiplier of a running event (the cog's `get_event_multiplier`).
 * An expired event simply reads as 1 — nothing to clean up.
 */
export function eventMultiplier(guildId, now = Date.now()) {
  const event = rawSettings(guildId).event;
  if (!event || now > event.endsAt) return 1;
  return event.multiplier;
}

/**
 * When the running event ends, or 0 when nothing is running (S130).
 *
 * The event panel needs the deadline, not just the multiplier — "2× rewards"
 * with no end in sight reads as permanent.
 */
export function heistEventEndsAt(guildId, now = Date.now()) {
  const event = rawSettings(guildId).event;
  return event && now <= event.endsAt ? event.endsAt : 0;
}

export function startHeistEvent(guildId, multiplier, hours, now = Date.now()) {
  if (!Number.isInteger(multiplier) || multiplier < 2 || multiplier > 5) return { ok: false, error: 'bad-multiplier' };
  if (!Number.isFinite(hours) || hours <= 0 || hours > 168) return { ok: false, error: 'bad-duration' };
  const endsAt = now + hours * 3_600_000;
  updateGuildData(guildId, HEIST_SETTINGS_KEY, (all) => ({ ...all, event: { multiplier, endsAt } }), {});
  return { ok: true, endsAt };
}

export function stopHeistEvent(guildId) {
  updateGuildData(guildId, HEIST_SETTINGS_KEY, (all) => ({ ...all, event: null }), {});
}

// ── crew robbery (S88 = slice D) ─────────────────────────────────────────────

const crewLobbies = new Map(); // channelId → lobby

let crewSeq = 0;

export const getCrewLobby = (channelId) => crewLobbies.get(channelId) ?? null;

export function createCrewLobby(channelId, guildId, hostId) {
  if (crewLobbies.has(channelId)) return { error: 'busy' };
  crewSeq += 1;
  const lobby = {
    id: `${Date.now().toString(36)}-${crewSeq}`,
    channelId,
    guildId,
    hostId,
    members: [hostId], // the organiser is in by definition (cog behavior)
    message: null,
    timer: null,
  };
  crewLobbies.set(channelId, lobby);
  return { lobby };
}

export function joinCrewLobby(lobby, userId) {
  if (lobby.members.includes(userId)) return 'already';
  if (lobby.members.length >= CREW_SIZE) return 'full';
  lobby.members.push(userId);
  return 'joined';
}

export function leaveCrewLobby(lobby, userId) {
  if (userId === lobby.hostId) return 'organiser';
  const index = lobby.members.indexOf(userId);
  if (index === -1) return 'not-joined';
  lobby.members.splice(index, 1);
  return 'left';
}

export function closeCrewLobby(channelId) {
  const lobby = crewLobbies.get(channelId);
  if (lobby?.timer) clearTimeout(lobby.timer);
  crewLobbies.delete(channelId);
  return lobby ?? null;
}

/** Arm the cog's 3-minute lobby expiry. */
export function armCrewLobbyTimer(lobby, callback, ms = CREW_LOBBY_TIMEOUT_MS) {
  if (lobby.timer) clearTimeout(lobby.timer);
  lobby.timer = setTimeout(callback, ms);
  lobby.timer.unref?.();
}

/** Test seam. */
export function clearAllCrewLobbies() {
  for (const channelId of [...crewLobbies.keys()]) closeCrewLobby(channelId);
}

/**
 * Send the crew on the job: every member gets the same activeHeist record,
 * tagged with the crew and its leader so only ONE settlement runs.
 */
export function startCrewHeist(guildId, memberIds, channelId, { now = Date.now() } = {}) {
  const heist = getHeistSettings(guildId, 'crew_robbery');
  const endsAt = now + heist.durationMs;
  const leader = memberIds[0];
  for (const userId of memberIds) {
    updatePlayer(
      guildId,
      userId,
      (player) => ({
        ...player,
        cooldowns: { ...player.cooldowns, crew_robbery: now },
        activeHeist: { type: 'crew_robbery', endsAt, channelId, taxAgreed: false, crew: [...memberIds], leader },
      }),
      now,
    );
  }
  return { endsAt, leader };
}

/**
 * Settle a whole crew at once. Only the leader's record drives this; the
 * other members' records are cleared in the same pass.
 */
export async function settleCrewHeist(guildId, leaderId, { now = Date.now(), rng = defaultRng } = {}) {
  const leaderPlayer = getPlayer(guildId, leaderId, now);
  const active = leaderPlayer.activeHeist;
  if (!active?.crew) return null;
  if (now < active.endsAt) return null;

  const heist = getHeistSettings(guildId, 'crew_robbery');
  const members = [];
  for (const userId of active.crew) {
    // eslint-disable-next-line no-await-in-loop -- four members, one settlement
    const balance = await heistBalance(guildId, userId);
    members.push({ userId, player: getPlayer(guildId, userId, now), balance, taxAgreed: false });
  }

  const outcome = resolveCrewHeist(
    { heistType: 'crew_robbery', heist, members, eventMultiplier: eventMultiplier(guildId, now), now },
    rng,
  );

  for (const result of outcome.members) {
    // eslint-disable-next-line no-await-in-loop -- four members, one settlement
    await heistAdjustBalance(guildId, result.userId, result.balanceDelta);
    updatePlayer(
      guildId,
      result.userId,
      (current) => ({
        ...current,
        ...result.nextState,
        cooldowns: current.cooldowns,
        jail: result.jail ? { endsAt: result.jail.endsAt, bail: result.jail.bail } : current.jail,
        activeHeist: null,
      }),
      now,
    );
  }
  return { ...outcome, channelId: active.channelId };
}
