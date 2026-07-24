// Birthdays service: store access + the announcement sweep. Pure calendar
// rules live in lib/birthday.js; this file wires them to the store and the
// configured channel.
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { dueBirthdays } from './lib/birthday.js';
import { grantBirthdayBonus } from '../economy/service.js';

export const BIRTHDAY_CONFIG_KEY = 'birthdayConfig';
export const BIRTHDAY_USERS_KEY = 'birthdayUsers';
// Owner decision 2026-07-24 (S31): birthday announcements land in this channel
// by default — committed as product config (same pattern as the chat starter
// and the memorial feeds). /birthday-config overrides still win.
export const DEFAULT_BIRTHDAY_CONFIG = { enabled: true, channelId: '411609312037961729' };

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
 * One announcement sweep for a guild: find due birthdays, announce each in the
 * configured channel, and mark them announced for this local year (idempotent —
 * a restart or overlapping sweep can never double-announce thanks to the
 * lastAnnouncedYear stamp being written before the send).
 */
export async function sweepBirthdays(guild, now = Date.now()) {
  const config = getBirthdayConfig(guild.id);
  if (!config.enabled || !config.channelId) return 0;
  const channel = guild.channels.cache.get(config.channelId);
  if (!channel?.send) return 0;

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
