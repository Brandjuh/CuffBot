// Economy service: donut balances in the guild store, activity earnings, and
// the live crook-hunt game (spawn → catch/expire). Pure rules live in
// lib/bank.js; this file owns store access, the RAM hunt state, and Discord
// sends. Other modules award donuts through adjustBalance/grantBirthdayBonus
// (cross-module seam, always wrapped in try/catch by the caller).
import { getGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import {
  DEFAULT_ECONOMY_CONFIG,
  catchReward,
  channelIsActive,
  earnGain,
  heistSucceeds,
  huntDurationMs,
  pickVictim,
  shouldSpawnHunt,
  stealAmount,
  trackActivity,
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

/**
 * One /steal attempt (S40 owner spec): 30% success moves the loot from the
 * target to the thief; a failed attempt moves it from the thief to the
 * precinct chief — the SERVER OWNER (guild.ownerId resolves to Brandjuh
 * without hardcoding a personal id). Amounts are capped by what the payer
 * actually has (balances floor at 0), reported honestly via `amount`.
 * @returns {{code:'disabled'|'self'|'cooldown'|'success'|'failure',
 *            amount?:number, waitMs?:number, chiefId?:string}}
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
  const chiefId = guild.ownerId ?? null;
  const { applied } = adjustBalance(guildId, thiefId, -config.heistAmount);
  const seized = Math.abs(applied);
  if (seized > 0 && chiefId) adjustBalance(guildId, chiefId, seized);
  return { code: 'failure', amount: seized, chiefId };
}

/** Top balances: [{userId, balance}], richest first. */
export function topBalances(guildId, limit = 10) {
  const max = Math.max(1, Math.min(25, Number.isFinite(limit) ? limit : 10));
  return Object.entries(getAccounts(guildId))
    .map(([userId, rec]) => ({ userId, balance: rec.balance }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, max);
}

// ── the crook hunt (RAM state; a restart simply forfeits the open hunt) ──────

const activityState = new Map(); // channelId → recent human messages
const lastHuntAt = new Map(); // channelId → timestamp of the last spawn
const activeHunts = new Map(); // channelId → {guildId, expiresAt, reward, timer, messageId}

export function activeHunt(channelId) {
  return activeHunts.get(channelId) ?? null;
}

/** Test hook: clear all RAM hunt state. */
export function resetHuntState() {
  for (const hunt of activeHunts.values()) clearTimeout(hunt.timer);
  activeHunts.clear();
  activityState.clear();
  lastHuntAt.clear();
}

/**
 * Track a human message and maybe spawn a crook in this channel. Returns true
 * when a hunt spawned. Requires the Message Content intent — without it the
 * "STOP POLICE" shout is invisible, so spawning would be a rigged game.
 */
export async function noteActivityAndMaybeSpawn(message, { random = Math.random, now = Date.now() } = {}) {
  const config = getEconomyConfig(message.guild.id);
  if (!config.enabled || !config.huntEnabled) return false;
  const channelId = message.channel.id;
  // Track always (harmless, and the game starts instantly once the intent is
  // enabled) — but never SPAWN without Message Content: the bot couldn't hear
  // "STOP POLICE", making the hunt unwinnable.
  trackActivity(activityState, channelId, message.author.id, now, config);
  if (!message.client.messageContentAvailable) return false;
  if (activeHunts.has(channelId)) return false;
  const active = channelIsActive(activityState, channelId, now, config);
  if (!shouldSpawnHunt({ active, lastHuntAt: lastHuntAt.get(channelId), now, config, random })) {
    return false;
  }
  return spawnHunt(message.channel, { random, now });
}

/** Post the crook and arm the 5–20 s flee timer. */
export async function spawnHunt(channel, { random = Math.random, now = Date.now(), durationMs = null } = {}) {
  const guild = channel.guild;
  const config = getEconomyConfig(guild.id);
  const lingerMs = durationMs ?? huntDurationMs(config, random);
  const reward = catchReward(config, random);
  try {
    const posted = await channel.send({
      content:
        '🦹 **A crook is sprinting through this channel!** First officer to shout **STOP POLICE** cuffs them and pockets the bounty. Quick — they won’t stick around!',
      allowedMentions: { parse: [] },
    });
    const hunt = {
      guildId: guild.id,
      channelId: channel.id,
      reward,
      expiresAt: now + lingerMs,
      messageId: posted?.id ?? null,
      timer: setTimeout(() => {
        activeHunts.delete(channel.id);
        expireHunt(channel, { random }).catch((error) =>
          logger.warn('Economy: hunt expiry failed:', error),
        );
      }, lingerMs),
    };
    hunt.timer.unref?.();
    activeHunts.set(channel.id, hunt);
    lastHuntAt.set(channel.id, now);
    return true;
  } catch (error) {
    logger.warn('Economy: could not spawn a hunt:', error);
    return false;
  }
}

/**
 * A message arrived in a channel with an open hunt and shouted the phrase:
 * cuff the crook, pay the officer. Returns the reward, or null if the hunt
 * was already gone (raced the flee timer).
 */
export async function resolveCatch(message, { now = Date.now() } = {}) {
  const hunt = activeHunts.get(message.channel.id);
  if (!hunt || now >= hunt.expiresAt) return null;
  clearTimeout(hunt.timer);
  activeHunts.delete(message.channel.id);
  const { balance } = adjustBalance(hunt.guildId, message.author.id, hunt.reward);
  const officer = message.member?.displayName ?? message.author.username ?? 'An officer';
  await message.channel
    .send({
      content: `🚔 **GOTCHA!** ${officer} cuffed the crook and earned **${hunt.reward.toLocaleString('en-US')} donuts** 🍩 (balance: ${balance.toLocaleString('en-US')}).`,
      allowedMentions: { parse: [] },
    })
    .catch(() => {});
  return hunt.reward;
}

/** The crook fled: steal donuts from a random member and announce it. */
export async function expireHunt(channel, { random = Math.random } = {}) {
  const guild = channel.guild;
  const config = getEconomyConfig(guild.id);

  // Victim pool: real (non-bot) members from the cache; fall back to everyone
  // with a donut account. The victim's account materializes on the write, so
  // stealing from a fresh member correctly dips into their starting 10k.
  let candidates = [...(guild.members?.cache?.values() ?? [])]
    .filter((m) => !m.user?.bot)
    .map((m) => m.id);
  if (candidates.length === 0) candidates = Object.keys(getAccounts(guild.id));
  const victimId = pickVictim(candidates, random);

  if (!victimId) {
    await channel
      .send({ content: '💨 The crook got away — nothing in their pockets this time.', allowedMentions: { parse: [] } })
      .catch(() => {});
    return null;
  }

  const wanted = stealAmount(config, random);
  const { applied } = adjustBalance(guild.id, victimId, -wanted);
  const stolen = Math.abs(applied);
  const victimName =
    guild.members?.cache?.get(victimId)?.displayName ?? `<@${victimId}>`;
  const line =
    stolen > 0
      ? `💨 **The crook got away…** and pickpocketed **${stolen.toLocaleString('en-US')} donuts** 🍩 from **${victimName}**. Next time, shout STOP POLICE!`
      : `💨 **The crook got away…** they tried to rob **${victimName}**, but found only crumbs.`;
  await channel.send({ content: line, allowedMentions: { parse: [] } }).catch(() => {});
  return { victimId, stolen };
}
