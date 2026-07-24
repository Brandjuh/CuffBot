// Birthdays service: store access + the announcement sweep. Pure calendar
// rules live in lib/birthday.js; this file wires them to the store and the
// configured channel.
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { birthdayCelebrants, dueBirthdays } from './lib/birthday.js';
import { grantBirthdayBonus } from '../economy/service.js';
import { resolveSendableChannel } from '../../core/channels.js';

export const BIRTHDAY_CONFIG_KEY = 'birthdayConfig';
export const BIRTHDAY_USERS_KEY = 'birthdayUsers';
export const BIRTHDAY_ROLE_HOLDERS_KEY = 'birthdayRoleHolders';
// Owner decision 2026-07-24 (S31): birthday announcements land in this channel
// by default — committed as product config (same pattern as the chat starter
// and the memorial feeds). /birthday-config overrides still win.
// birthdayRoleId (S58 owner decision): celebrants wear this role for their
// whole local birthday; the sweep adds and removes it.
export const DEFAULT_BIRTHDAY_CONFIG = {
  enabled: true,
  channelId: '411609312037961729',
  birthdayRoleId: '701577807070756946',
};

export function getBirthdayConfig(guildId) {
  return { ...DEFAULT_BIRTHDAY_CONFIG, ...getGuildData(guildId, BIRTHDAY_CONFIG_KEY, {}) };
}

/** Persist only overrides (sparse), like every other module config. */
export function setBirthdayConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, BIRTHDAY_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, BIRTHDAY_CONFIG_KEY, stored);
  return { ...DEFAULT_BIRTHDAY_CONFIG, ...stored };
}

export function getBirthdayUsers(guildId) {
  return getGuildData(guildId, BIRTHDAY_USERS_KEY, {});
}

export function setBirthday(guildId, userId, { day, month, timeZone, year = null }) {
  return updateGuildData(
    guildId,
    BIRTHDAY_USERS_KEY,
    // The year (S44: YYYY/MM/DD input) is stored but never announced — the
    // sweep and upcoming list read only day/month/timeZone.
    (users) => ({ ...users, [userId]: { day, month, timeZone, ...(year ? { year } : {}) } }),
    {},
  );
}

/** @returns {boolean} whether a record existed */
export function removeBirthday(guildId, userId) {
  let existed = false;
  updateGuildData(
    guildId,
    BIRTHDAY_USERS_KEY,
    (users) => {
      existed = userId in users;
      if (!existed) return users;
      const next = { ...users };
      delete next[userId];
      return next;
    },
    {},
  );
  return existed;
}

/**
 * Keep the birthday role in sync (S58 owner request: celebrants wear role
 * `birthdayRoleId` for their WHOLE local birthday). Runs every sweep tick:
 * celebrants get the role (only when they don't hold it yet — no API spam),
 * and members WE granted it to lose it once their local day ends. Only roles
 * this bot granted are ever removed (`birthdayRoleHolders` store map) — a
 * manually assigned birthday role is never stripped. Failures are logged and
 * retried next tick; a vanished member just drops off the holder list.
 * @returns {Promise<{added: number, removed: number}>}
 */
export async function syncBirthdayRole(guild, now = Date.now()) {
  const config = getBirthdayConfig(guild.id);
  const roleId = config.birthdayRoleId;
  const result = { added: 0, removed: 0 };
  if (!config.enabled || !roleId) return result;

  const celebrants = new Set(birthdayCelebrants(getBirthdayUsers(guild.id), now));
  const holders = getGuildData(guild.id, BIRTHDAY_ROLE_HOLDERS_KEY, {});

  const setHolder = (userId, on) =>
    updateGuildData(
      guild.id,
      BIRTHDAY_ROLE_HOLDERS_KEY,
      (all) => {
        const next = { ...all };
        if (on) next[userId] = true;
        else delete next[userId];
        return next;
      },
      {},
    );

  for (const userId of celebrants) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue; // left the guild — nothing to wear the role
    try {
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId, 'Birthday role: it is their birthday — via CuffBot');
        result.added += 1;
      }
      setHolder(userId, true);
    } catch (error) {
      logger.warn(`Birthdays: could not give the birthday role to ${userId}:`, error?.message ?? error);
    }
  }

  for (const userId of Object.keys(holders)) {
    if (celebrants.has(userId)) continue;
    try {
      const member = await guild.members.fetch(userId).catch(() => null);
      if (member?.roles.cache.has(roleId)) {
        await member.roles.remove(roleId, 'Birthday role: the day is over — via CuffBot');
        result.removed += 1;
      }
      setHolder(userId, false); // gone or stripped either way — stop tracking
    } catch (error) {
      // Removal failed (hierarchy/permissions/API): keep tracking, retry next tick.
      logger.warn(`Birthdays: could not remove the birthday role from ${userId}:`, error?.message ?? error);
    }
  }
  return result;
}

/**
 * One announcement sweep for a guild: find due birthdays, announce each in the
 * configured channel, and mark them announced for this local year (idempotent —
 * a restart or overlapping sweep can never double-announce thanks to the
 * lastAnnouncedYear stamp being written before the send).
 */
export async function sweepBirthdays(guild, now = Date.now()) {
  const config = getBirthdayConfig(guild.id);
  if (!config.enabled || !config.channelId) return 0;
  const channel = await resolveSendableChannel(guild, config.channelId);
  if (!channel) return 0;

  const due = dueBirthdays(getBirthdayUsers(guild.id), now);
  let announced = 0;
  for (const { userId, localYear } of due) {
    // Stamp first: if the send fails we skip this year rather than risk a
    // pileup of duplicate announcements on every later sweep tick.
    updateGuildData(
      guild.id,
      BIRTHDAY_USERS_KEY,
      (users) =>
        users[userId] ? { ...users, [userId]: { ...users[userId], lastAnnouncedYear: localYear } } : users,
      {},
    );
    // Cross-module seam (S38): birthday members get a donut gift, mentioned
    // right in the announcement. Wrapped: a broken economy must never silence
    // the birthday itself.
    let bonus = null;
    try {
      bonus = grantBirthdayBonus(guild.id, userId);
    } catch (error) {
      logger.warn('Birthdays: donut bonus failed:', error);
    }
    const bonusLine = bonus
      ? ` The precinct chipped in **${bonus.toLocaleString('en-US')} donuts** 🍩 as a birthday gift!`
      : '';
    try {
      await channel.send({
        content: `🎂 **Attention all units!** Today is <@${userId}>'s birthday — report to the break room for cake and donuts. 🎉🍩${bonusLine}`,
        allowedMentions: { users: [userId] },
      });
      announced += 1;
    } catch (error) {
      logger.warn('Birthdays: announcement failed:', error);
    }
  }
  return announced;
}
