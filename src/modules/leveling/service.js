// Leveling helpers that touch the store and live Discord objects (role
// application, announcements) — kept out of lib/ so lib/ stays pure. XP records
// live in the per-guild store; the rank ladder is owned by the academy module
// and passed in (never re-derived here).
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { auditReason } from '../enforcement/lib/audit.js';
import { currentRankIndex } from '../academy/lib/ladder.js';
import {
  DEFAULT_XP_CONFIG,
  messageXpGain,
  planRankSync,
  seedXpForRankIndex,
  voiceXpGain,
} from './lib/xp.js';

export const XP_CONFIG_KEY = 'xpConfig';
export const XP_USERS_KEY = 'xpUsers';

// Service-level config extends the pure math config with the switches only the
// live bot cares about. enabled defaults on: the owner wants CuffBot's own XP
// system to replace the old leveler bot. syncRoles gates auto-assigning ranks.
export const DEFAULT_SERVICE_CONFIG = {
  ...DEFAULT_XP_CONFIG,
  enabled: true,
  syncRoles: true,
  announceChannelId: null,
};

export function getXpConfig(guildId) {
  return { ...DEFAULT_SERVICE_CONFIG, ...getGuildData(guildId, XP_CONFIG_KEY, {}) };
}

export function setXpConfig(guildId, patch) {
  const next = { ...getXpConfig(guildId), ...patch };
  setGuildData(guildId, XP_CONFIG_KEY, next);
  return next;
}

export function getUsers(guildId) {
  return getGuildData(guildId, XP_USERS_KEY, {});
}

export function getUserXp(guildId, userId) {
  const rec = getUsers(guildId)[userId];
  return rec ? rec.xp : 0;
}

/**
 * The XP record for a member, seeding a fresh one if we've never seen them.
 * Existing members are coupled to the rank role they already hold (seed = that
 * rank's floor); brand-new members with no rank start at 0. Pure decision lives
 * in seedXpForRankIndex; this only reads the member's live roles.
 */
function readOrSeed(users, member, ladder, config) {
  if (users[member.id]) return users[member.id];
  const idx = currentRankIndex([...member.roles.cache.keys()], ladder);
  const rank = idx < 0 ? null : ladder.ranks[idx];
  return {
    xp: seedXpForRankIndex(idx, ladder.ranks.length, config),
    lastMessageAt: null,
    seededFromRank: rank?.name ?? null,
  };
}

/** Ensure a member has a (seeded) XP record without awarding anything. */
export function ensureSeeded(guildId, member, ladder, config) {
  // Read-only fast path: no write when the record already exists. Safe because
  // the store is synchronous — nothing can interleave between check and write.
  const existing = getUsers(guildId)[member.id];
  if (existing) return existing;
  let record;
  updateGuildData(
    guildId,
    XP_USERS_KEY,
    (users) => {
      record = readOrSeed(users, member, ladder, config);
      return users[member.id] ? users : { ...users, [member.id]: record };
    },
    {},
  );
  return record;
}

/** Award message XP (respecting the cooldown), seeding on first sight. */
export function awardMessageXp(guildId, member, ladder, config, now) {
  // Read-only fast path: within the cooldown nothing changes, so don't rewrite
  // the store on every chat message (the Pi's SD card thanks us).
  const existing = getUsers(guildId)[member.id];
  if (existing && messageXpGain(config, existing.lastMessageAt, now) === 0) {
    return { gained: 0, xp: existing.xp, seeded: false };
  }
  let out = { gained: 0, xp: 0, seeded: false };
  updateGuildData(
    guildId,
    XP_USERS_KEY,
    (users) => {
      const existed = Boolean(users[member.id]);
      const rec = { ...readOrSeed(users, member, ladder, config) };
      const gain = messageXpGain(config, rec.lastMessageAt, now);
      if (gain > 0) {
        rec.xp += gain;
        rec.lastMessageAt = now;
      }
      out = { gained: gain, xp: rec.xp, seeded: !existed };
      return { ...users, [member.id]: rec };
    },
    {},
  );
  return out;
}

/** Award one minute of voice XP, seeding on first sight. */
export function awardVoiceMinute(guildId, member, ladder, config) {
  return awardVoiceMinutes(guildId, [member], ladder, config)[0];
}

/**
 * Award one minute of voice XP to a whole sweep's worth of members in a single
 * store write (one write per tick, not per member — kinder to the Pi's SD
 * card, and the tick lands atomically). Seeds each member on first sight.
 * @returns {Array<{member, gained:number, xp:number, seeded:boolean}>} same order as input
 */
export function awardVoiceMinutes(guildId, members, ladder, config) {
  const gain = voiceXpGain(config, 60_000);
  const results = [];
  if (members.length === 0) return results;
  updateGuildData(
    guildId,
    XP_USERS_KEY,
    (users) => {
      const next = { ...users };
      for (const member of members) {
        const existed = Boolean(next[member.id]);
        const rec = { ...readOrSeed(next, member, ladder, config) };
        rec.xp += gain;
        next[member.id] = rec;
        results.push({ member, gained: gain, xp: rec.xp, seeded: !existed });
      }
      return next;
    },
    {},
  );
  return results;
}

/** Top members by XP: [{ userId, xp }], highest first. */
export function leaderboard(guildId, limit = 10) {
  return Object.entries(getUsers(guildId))
    .map(([userId, rec]) => ({ userId, xp: rec.xp }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, limit);
}

/**
 * Bring a member's rank role in line with their XP — promote-only. We never
 * strip a rank via XP (demotion stays a manual /demote), so a misconfigured
 * ladder or a redeploy can never mass-demote the server. Gated on syncRoles and
 * on the bot actually being able to manage the target role.
 * @returns {Promise<{changed:boolean, from?:string|null, to?:string, blocked?:boolean}>}
 */
export async function syncMemberRank(member, ladder, xp, config) {
  if (!config.syncRoles) return { changed: false };
  const plan = planRankSync([...member.roles.cache.keys()], ladder, xp, config);
  if (!plan.changed) return { changed: false };

  const targetRole = member.guild.roles.cache.get(plan.addRoleId);
  if (targetRole && targetRole.editable === false) return { changed: false, blocked: true };

  const reason = auditReason(`XP promotion to ${plan.toName}`, 'CuffBot XP');
  try {
    if (plan.removeRoleIds.length > 0) await member.roles.remove(plan.removeRoleIds, reason);
    await member.roles.add(plan.addRoleId, reason);
  } catch (error) {
    logger.warn('Leveling: rank sync failed:', error);
    return { changed: false, blocked: true };
  }
  return { changed: true, from: plan.fromName, to: plan.toName };
}

/** Announce a promotion to the configured channel, or a fallback if given. */
export async function announceRankUp(guild, member, sync, config, fallbackChannel = null) {
  const who = member.displayName ?? member.user?.username ?? 'An officer';
  const text = sync.from
    ? `🎖️ **${who}** earned a promotion: **${sync.from}** → **${sync.to}**! Congratulations, officer.`
    : `🎖️ **${who}** earned their first stripes: **${sync.to}**! Welcome to the force.`;

  let channel = null;
  if (config.announceChannelId) channel = guild.channels.cache.get(config.announceChannelId) ?? null;
  if (!channel) channel = fallbackChannel;
  if (!channel?.send) return;
  await channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => {});
}
