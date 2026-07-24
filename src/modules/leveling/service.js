// Leveling helpers that touch the store and live Discord objects (role
// application, announcements) — kept out of lib/ so lib/ stays pure. XP records
// live in the per-guild store; the rank ladder is owned by the academy module
// and passed in (never re-derived here).
//
// Trust rule: everything AUTOMATED here (seeding XP from a held rank, syncing
// rank roles, coupling XP on promote/demote) requires the ladder to be PINNED
// via /rank-setup (academy's isPinnedLadder). A heuristic ladder is fine for a
// human reading /ranks, but letting automation act on one would hand out roles
// and write XP based on a guessed header. Earning XP itself is never gated —
// records seeded at 0 under an unpinned ladder self-heal (see reconcile).
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { auditReason } from '../enforcement/lib/audit.js';
import { currentRankIndex } from '../academy/lib/ladder.js';
import { isPinnedLadder, ladderForGuild } from '../academy/service.js';
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

/**
 * Persist only the overridden keys (sparse), never the merged defaults — a
 * frozen copy of every default would silently pin this guild to today's
 * numbers if DEFAULT_XP_CONFIG is ever rebalanced in code.
 */
export function setXpConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, XP_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, XP_CONFIG_KEY, stored);
  return { ...DEFAULT_SERVICE_CONFIG, ...stored };
}

export function getUsers(guildId) {
  return getGuildData(guildId, XP_USERS_KEY, {});
}

export function getUserXp(guildId, userId) {
  const rec = getUsers(guildId)[userId];
  return rec ? rec.xp : 0;
}

/** The floor XP for the rank this member currently holds (0 if none). */
function heldRankFloor(member, ladder, config) {
  const idx = currentRankIndex([...member.roles.cache.keys()], ladder);
  const rank = idx < 0 ? null : ladder.ranks[idx];
  return { floor: seedXpForRankIndex(idx, ladder.ranks.length, config), rank };
}

/**
 * The XP record for a member, seeding a fresh one if we've never seen them.
 * Existing members are coupled to the rank role they already hold (seed = that
 * rank's floor); brand-new members with no rank start at 0. Only a PINNED
 * ladder may seed from a rank — under an unpinned/broken ladder we seed 0 and
 * let reconcile() heal the record once the ladder is trustworthy.
 */
function readOrSeed(users, member, ladder, config, trusted) {
  if (users[member.id]) return users[member.id];
  const { floor, rank } = trusted ? heldRankFloor(member, ladder, config) : { floor: 0, rank: null };
  return {
    xp: floor,
    lastMessageAt: null,
    seededFromRank: rank?.name ?? null,
  };
}

/**
 * Self-healing (fix for the audit's HIGH finding): if a member's XP sits BELOW
 * the floor of the rank they visibly hold — because they were first seen while
 * the ladder was broken/unpinned, or a human promoted them by hand — raise it
 * to that floor. Monotonic (never lowers XP), idempotent, and only ever acts
 * on a pinned ladder. Returns the healed record, or null when nothing changed.
 */
function reconcile(rec, member, ladder, config, trusted) {
  if (!trusted) return null;
  const { floor, rank } = heldRankFloor(member, ladder, config);
  if (rec.xp >= floor) return null;
  return { ...rec, xp: floor, seededFromRank: rec.seededFromRank ?? rank?.name ?? null };
}

/** Ensure a member has a (seeded, reconciled) XP record without awarding anything. */
export function ensureSeeded(guildId, member, ladder, config) {
  const trusted = isPinnedLadder(guildId, ladder);
  // Read-only fast path: no write when the record exists and needs no healing.
  // Safe because the store is synchronous — nothing interleaves check and write.
  const existing = getUsers(guildId)[member.id];
  if (existing && !reconcile(existing, member, ladder, config, trusted)) return existing;
  let record;
  updateGuildData(
    guildId,
    XP_USERS_KEY,
    (users) => {
      const rec = readOrSeed(users, member, ladder, config, trusted);
      record = reconcile(rec, member, ladder, config, trusted) ?? rec;
      return { ...users, [member.id]: record };
    },
    {},
  );
  return record;
}

/** Award message XP (respecting the cooldown), seeding on first sight. */
export function awardMessageXp(guildId, member, ladder, config, now) {
  const trusted = isPinnedLadder(guildId, ladder);
  // Read-only fast path: within the cooldown nothing changes, so don't rewrite
  // the store on every chat message (the Pi's SD card thanks us). Healing a
  // below-floor record waits for the next awarded message.
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
      let rec = { ...readOrSeed(users, member, ladder, config, trusted) };
      rec = reconcile(rec, member, ladder, config, trusted) ?? rec;
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
  const trusted = isPinnedLadder(guildId, ladder);
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
        let rec = { ...readOrSeed(next, member, ladder, config, trusted) };
        rec = reconcile(rec, member, ladder, config, trusted) ?? rec;
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

/**
 * Couple a member's XP to a rank a HUMAN just gave them (the /promote and
 * /demote seam): a promotion raises XP to at least the new rank's floor, a
 * demotion caps XP at the new rank's floor. Keeps rank↔XP coherent, and stops
 * the promote-only auto-sync from instantly undoing a human demotion. No-op on
 * an unpinned ladder or when the role is not on it.
 * @param {'promote'|'demote'} mode
 * @returns {number|null} the resulting XP, or null when nothing was written
 */
export function coupleXpToRank(guildId, userId, ladder, targetRoleId, mode) {
  if (!isPinnedLadder(guildId, ladder)) return null;
  const idx = ladder.ranks.findIndex((r) => r.roleId === targetRoleId);
  if (idx < 0) return null;
  const config = getXpConfig(guildId);
  const floor = seedXpForRankIndex(idx, ladder.ranks.length, config);
  let result = null;
  updateGuildData(
    guildId,
    XP_USERS_KEY,
    (users) => {
      const rec = users[userId]
        ? { ...users[userId] }
        : { xp: 0, lastMessageAt: null, seededFromRank: null };
      const xp = mode === 'demote' ? Math.min(rec.xp, floor) : Math.max(rec.xp, floor);
      if (xp === rec.xp && users[userId]) return users; // nothing to write
      rec.xp = xp;
      if (rec.seededFromRank === null && !users[userId]) {
        rec.seededFromRank = ladder.ranks[idx].name;
      }
      result = xp;
      return { ...users, [userId]: rec };
    },
    {},
  );
  return result;
}

/** Top members by XP: [{ userId, xp }], highest first. */
export function leaderboard(guildId, limit = 10) {
  const max = Math.max(1, Math.min(25, Number.isFinite(limit) ? limit : 10));
  return Object.entries(getUsers(guildId))
    .map(([userId, rec]) => ({ userId, xp: rec.xp }))
    .sort((a, b) => b.xp - a.xp)
    .slice(0, max);
}

// One warning per guild per process when auto-sync is skipped because the
// ladder is not pinned — visible in journalctl without spamming every message.
const unpinnedWarned = new Set();
// Per-member in-flight guard: a message award and a voice-sweep award can
// cross a threshold in the same instant; without this both would plan from the
// same stale role cache and announce the promotion twice.
const syncInFlight = new Set();

/**
 * Bring a member's rank role in line with their XP — promote-only. We never
 * strip a rank via XP (demotion stays a manual /demote), so a misconfigured
 * ladder or a redeploy can never mass-demote the server. Gated on syncRoles,
 * on a PINNED ladder, and on the bot actually managing the target role.
 * @returns {Promise<{changed:boolean, from?:string|null, to?:string, blocked?:boolean}>}
 */
export async function syncMemberRank(member, ladder, xp, config, { reasonLabel = 'XP promotion' } = {}) {
  if (!config.syncRoles) return { changed: false };
  const guildId = member.guild.id;
  if (!isPinnedLadder(guildId, ladder)) {
    if (!unpinnedWarned.has(guildId)) {
      unpinnedWarned.add(guildId);
      logger.warn(
        'Leveling: rank auto-sync is idle — the ladder is not pinned. An admin must run /rank-setup header:@<divider role> once.',
      );
    }
    return { changed: false };
  }
  const plan = planRankSync([...member.roles.cache.keys()], ladder, xp, config);
  if (!plan.changed) return { changed: false };

  const key = `${guildId}:${member.id}`;
  if (syncInFlight.has(key)) return { changed: false }; // another sync is mid-flight
  syncInFlight.add(key);
  try {
    const targetRole = member.guild.roles.cache.get(plan.addRoleId);
    if (targetRole && targetRole.editable === false) return { changed: false, blocked: true };
    const reason = auditReason(`${reasonLabel} to ${plan.toName}`, 'CuffBot XP');
    if (plan.removeRoleIds.length > 0) await member.roles.remove(plan.removeRoleIds, reason);
    await member.roles.add(plan.addRoleId, reason);
    return { changed: true, from: plan.fromName, to: plan.toName };
  } catch (error) {
    logger.warn('Leveling: rank sync failed:', error);
    return { changed: false, blocked: true };
  } finally {
    syncInFlight.delete(key);
  }
}

// ── ladder-change reconciliation (S37) ───────────────────────────────────────
// The owner must be able to rename, reorder, delete, and add rank roles
// without breaking ranks/XP. Renames are free (role IDS anchor everything).
// Structural changes (the ordered id list differs) trigger a QUIET sweep that
// re-applies the exact same rules the live system already enforces — XP heals
// up to the held rank's floor, promote-only role sync to what XP earns under
// the NEW thresholds — so the sweep and the next message can never disagree.
// No announcements, and role writes are spaced out for rate limits.

export const LADDER_SNAPSHOT_KEY = 'ladderSnapshot';

/** The pinned ladder structure at the last reconciliation (role ids, highest first). */
export function getLadderSnapshot(guildId) {
  return getGuildData(guildId, LADDER_SNAPSHOT_KEY, null);
}

export function saveLadderSnapshot(guildId, ladder) {
  setGuildData(guildId, LADDER_SNAPSHOT_KEY, { roleIds: ladder.ranks.map((r) => r.roleId) });
}

/** Structure = the ordered rank-id list; renames never count as change. */
export function ladderStructureChanged(guildId, ladder) {
  const snapshot = getLadderSnapshot(guildId);
  if (!snapshot?.roleIds) return false; // first sight is a baseline, not a change
  const now = ladder.ranks.map((r) => r.roleId);
  return snapshot.roleIds.length !== now.length || snapshot.roleIds.some((id, i) => id !== now[i]);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function allMembers(guild) {
  if (guild.client?.memberEventsAvailable && guild.members?.fetch) {
    try {
      const fetched = await guild.members.fetch();
      return [...fetched.values()];
    } catch {
      /* fall back to cache */
    }
  }
  return [...(guild.members?.cache?.values() ?? [])];
}

/**
 * Seed an XP record for every member currently holding a rank role. Runs once
 * when a pinned ladder is first snapshotted, so a LATER role deletion still
 * has records to restore ex-holders from (after deletion the held-role trace
 * is gone — only a pre-existing record can bring those members back).
 */
export async function seedAllRankHolders(guild, ladder) {
  const config = getXpConfig(guild.id);
  let seeded = 0;
  for (const member of await allMembers(guild)) {
    if (member.user?.bot) continue;
    const roleIds = [...member.roles.cache.keys()];
    if (!ladder.ranks.some((r) => roleIds.includes(r.roleId))) continue;
    const existed = Boolean(getUsers(guild.id)[member.id]);
    ensureSeeded(guild.id, member, ladder, config);
    if (!existed) seeded += 1;
  }
  return seeded;
}

/**
 * Quietly bring every member back in line after a structural ladder change.
 * Per member: heal XP up to the held rank's floor (never down), then
 * promote-only role sync to what the XP earns under the new thresholds.
 * NO announcements; role writes spaced by `delayMs` (Discord rate limits);
 * hard cap as a runaway brake.
 */
export async function reconcileLadderChange(guild, ladder, { delayMs = 400, maxRoleWrites = 300 } = {}) {
  const guildId = guild.id;
  const config = getXpConfig(guildId);
  if (!config.enabled || !config.syncRoles) return { swept: false, reason: 'disabled' };
  if (!isPinnedLadder(guildId, ladder)) return { swept: false, reason: 'unpinned' };

  let healed = 0;
  let roleChanges = 0;
  let capped = false;
  for (const member of await allMembers(guild)) {
    if (member.user?.bot) continue;
    const roleIds = [...member.roles.cache.keys()];
    const holdsRank = ladder.ranks.some((r) => roleIds.includes(r.roleId));
    const hadRecord = Boolean(getUsers(guildId)[member.id]);
    if (!hadRecord && !holdsRank) continue; // bystander: nothing to reconcile
    const before = hadRecord ? getUsers(guildId)[member.id].xp : null;
    const rec = ensureSeeded(guildId, member, ladder, config);
    if (before !== null && rec.xp > before) healed += 1;
    const sync = await syncMemberRank(member, ladder, rec.xp, config, {
      reasonLabel: 'ladder-change reconciliation',
    });
    if (sync.changed) {
      roleChanges += 1;
      if (roleChanges >= maxRoleWrites) {
        capped = true;
        logger.warn(
          `Leveling: reconciliation hit the ${maxRoleWrites} role-write cap — the rest heals on activity or the next sweep.`,
        );
        break;
      }
      if (delayMs > 0) await sleep(delayMs);
    }
  }
  saveLadderSnapshot(guildId, ladder);
  return { swept: true, healed, roleChanges, capped };
}

/**
 * Compare the live ladder to the stored snapshot: baseline on first pinned
 * sight (and seed all rank holders so future deletions are recoverable),
 * sweep when the structure changed, no-op otherwise.
 */
export async function noteLadderMaybeChanged(guild, { sweepDelayMs = 400 } = {}) {
  const ladder = ladderForGuild(guild);
  if (!isPinnedLadder(guild.id, ladder)) return { swept: false, reason: 'unpinned' };
  if (!getLadderSnapshot(guild.id)?.roleIds) {
    const seeded = await seedAllRankHolders(guild, ladder);
    saveLadderSnapshot(guild.id, ladder);
    logger.info(`Leveling: ladder baseline snapshotted (${seeded} rank holder(s) seeded).`);
    return { swept: false, reason: 'baseline', seeded };
  }
  if (!ladderStructureChanged(guild.id, ladder)) return { swept: false, reason: 'unchanged' };
  const result = await reconcileLadderChange(guild, ladder, { delayMs: sweepDelayMs });
  if (result.swept) {
    logger.info(
      `Leveling: ladder change reconciled — ${result.roleChanges} quiet role change(s), ${result.healed} XP heal(s).`,
    );
  }
  return result;
}

// Debounce: a drag-reorder in the Discord UI fires one GuildRoleUpdate per
// shifted role — collapse the burst into one reconciliation.
const reconcilePending = new Map();

export function scheduleLadderReconcile(guild, { delayMs = 15_000, sweepDelayMs = 400 } = {}) {
  if (!guild) return false;
  const existing = reconcilePending.get(guild.id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    reconcilePending.delete(guild.id);
    noteLadderMaybeChanged(guild, { sweepDelayMs }).catch((error) =>
      logger.warn('Leveling: ladder reconciliation failed:', error),
    );
  }, delayMs);
  timer.unref?.();
  reconcilePending.set(guild.id, timer);
  return true;
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
