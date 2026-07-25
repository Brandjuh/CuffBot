// Hammertime service (S84 = M16.11): the timezone registry (per-user, with
// the cog's role-timezone fallback and its AmbiguousTimeZone rule), the auto
// mode toggle, and the RAM state for pending timezone-picker selects.
// Storage note: the cog stored user timezones bot-globally; CuffBot is
// single-guild by design (S1), so they live in the home guild's store.
import { getGuildData, updateGuildData } from '../../core/store.js';

export const HT_USERS_KEY = 'hammertimeUsers'; // { [userId]: zone }
export const HT_ROLES_KEY = 'hammertimeRoles'; // { [roleId]: zone }
export const HT_CONFIG_KEY = 'hammertimeConfig'; // { autoTime: false }

export function getUserTimezone(guildId, userId) {
  return getGuildData(guildId, HT_USERS_KEY, {})[userId] ?? null;
}

export function setUserTimezone(guildId, userId, zone) {
  updateGuildData(
    guildId,
    HT_USERS_KEY,
    (raw) => {
      const all = { ...raw };
      if (zone === null) delete all[userId];
      else all[userId] = zone;
      return all;
    },
    {},
  );
}

export function getRoleTimezones(guildId) {
  return { ...getGuildData(guildId, HT_ROLES_KEY, {}) };
}

export function setRoleTimezone(guildId, roleId, zone) {
  updateGuildData(
    guildId,
    HT_ROLES_KEY,
    (raw) => {
      const all = { ...raw };
      if (zone === null) delete all[roleId];
      else all[roleId] = zone;
      return all;
    },
    {},
  );
}

export function getAutoTime(guildId) {
  return getGuildData(guildId, HT_CONFIG_KEY, {}).autoTime ?? false;
}

export function setAutoTime(guildId, enabled) {
  updateGuildData(guildId, HT_CONFIG_KEY, (raw) => ({ ...raw, autoTime: enabled }), {});
}

/**
 * The cog's get_timezone_for: the member's own setting wins; otherwise their
 * roles' timezones — MORE THAN ONE timezone role is ambiguous (the cog
 * counts roles, not distinct zones; ported as-is), none is an error.
 * @param {string[]} memberRoleIds
 * @returns {{zone:string}|{error:'none'|'ambiguous'}}
 */
export function resolveTimezone(guildId, userId, memberRoleIds = []) {
  const own = getUserTimezone(guildId, userId);
  if (own) return { zone: own };
  const roleZones = getRoleTimezones(guildId);
  const hits = memberRoleIds.filter((roleId) => roleZones[roleId]);
  if (hits.length > 1) return { error: 'ambiguous' };
  if (hits.length === 0) return { error: 'none' };
  return { zone: roleZones[hits[0]] };
}

// ── pending timezone pickers (RAM) ───────────────────────────────────────────

const pendingPicks = new Map(); // userId → { options, roleId|null, guildId, message, timer }

export function getPendingPick(userId) {
  return pendingPicks.get(userId) ?? null;
}

/** Remember an open select; a fresh pick replaces (and disarms) the old one. */
export function setPendingPick(userId, pick) {
  clearPendingPick(userId);
  pendingPicks.set(userId, pick);
}

export function clearPendingPick(userId) {
  const pick = pendingPicks.get(userId);
  if (pick?.timer) clearTimeout(pick.timer);
  pendingPicks.delete(userId);
  return pick ?? null;
}

/** Test seam. */
export function clearAllPendingPicks() {
  for (const userId of [...pendingPicks.keys()]) clearPendingPick(userId);
}
