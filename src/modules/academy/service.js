// Academy helpers that touch live Discord objects (role resolution, hierarchy
// checks, applying role changes) — kept out of lib/ so lib/ stays pure.
import { PermissionFlagsBits } from 'discord.js';
import { getGuildData } from '../../core/store.js';
import { auditReason } from '../enforcement/lib/audit.js';
import { buildLadder } from './lib/ladder.js';

export const ACADEMY_CONFIG_KEY = 'academyConfig';
export const DEFAULT_CONFIG = { headerRoleId: null, excludedRoleIds: [] };

export function getAcademyConfig(guildId) {
  return { ...DEFAULT_CONFIG, ...getGuildData(guildId, ACADEMY_CONFIG_KEY, {}) };
}

/**
 * Named for the slash era. Since S54 there is no ephemeral on the text path —
 * this is simply the ctx's no-ping in-channel reply, kept as one helper so the
 * academy commands read consistently.
 */
export async function replyEphemeral(ctx, content) {
  await ctx.reply(content);
}

/** Guild roles ordered highest position first, as plain objects for lib/. */
export function guildRolesDesc(guild) {
  return [...guild.roles.cache.values()]
    .sort((a, b) => b.position - a.position)
    .map((r) => ({ id: r.id, name: r.name, managed: r.managed, position: r.position }));
}

/**
 * Resolve the guild's rank ladder from stored config + live role positions.
 * The interaction-free seam other modules (leveling) call to read the ladder.
 */
export function ladderForGuild(guild) {
  return buildLadder(guildRolesDesc(guild), getAcademyConfig(guild.id));
}

/** Resolve the guild's rank ladder from a ctx or an interaction. */
export function resolveLadder(source) {
  return ladderForGuild(source.guild);
}

/**
 * True when this ladder came from the admin-pinned header role (`!ranks setup`),
 * not the name heuristic. Human-driven commands (/promote, /ranks) may work
 * from a heuristic ladder — a human sees what they are doing — but AUTOMATED
 * actors (leveling's rank sync and XP seeding) must require the pin: a decoy
 * role name like "Level 100 Club" would otherwise silently become a ladder the
 * bot hands out roles from and seeds XP against.
 */
export function isPinnedLadder(guildId, ladder) {
  return pinDiagnosis(guildId, ladder).pinned;
}

/**
 * WHY the ladder is or is not pinned (S113).
 *
 * `isPinnedLadder` answers yes/no, and a bare "no" is what made this expensive:
 * the owner ran `!ranks setup` four times because nothing ever said which of
 * the four different "no"s he was looking at. They need different fixes, and
 * one of them is invisible — a pin whose role has since been **deleted or
 * recreated** (a recreated role gets a NEW id) silently falls back to the name
 * heuristic, so the stored pin is still displayed as configured while counting
 * for nothing.
 *
 * @returns {{ pinned: boolean, reason: 'ok'|'no-header'|'no-ranks'|'unpinned'|'stale-pin',
 *   storedHeaderRoleId: string|null, detectedHeaderRoleId: string|null }}
 */
export function pinDiagnosis(guildId, ladder) {
  const storedHeaderRoleId = getAcademyConfig(guildId).headerRoleId ?? null;
  const detectedHeaderRoleId = ladder?.headerRoleId ?? null;
  const base = { pinned: false, storedHeaderRoleId, detectedHeaderRoleId };

  if (!ladder?.headerFound) return { ...base, reason: 'no-header' };
  if (ladder.ranks.length === 0) return { ...base, reason: 'no-ranks' };
  if (!storedHeaderRoleId) return { ...base, reason: 'unpinned' };
  if (storedHeaderRoleId !== detectedHeaderRoleId) return { ...base, reason: 'stale-pin' };
  return { ...base, pinned: true, reason: 'ok' };
}

/** One line saying what to do about `pinDiagnosis`'s verdict. */
export function explainPin(diagnosis, prefix = '!') {
  switch (diagnosis.reason) {
    case 'ok':
      return `yes — pinned to <@&${diagnosis.storedHeaderRoleId}>`;
    case 'stale-pin':
      return (
        `⚠️ **no — the pinned role \`${diagnosis.storedHeaderRoleId}\` no longer exists.** ` +
        `A deleted or re-created role gets a new id, so the old pin counts for nothing. ` +
        `Re-run \`${prefix}ranks setup @<your divider role>\`.`
      );
    case 'no-header':
      return `⚠️ no — no header/divider role found at all. \`${prefix}ranks setup @<your divider role>\`.`;
    case 'no-ranks':
      return `⚠️ no — the header was found but no rank roles sit under it (all excluded, or the section is empty).`;
    default:
      return `⚠️ no — never pinned. \`${prefix}ranks setup @<your divider role>\`.`;
  }
}

/** Verify the bot can assign/remove the roles a rank change needs. */
export async function ensureManageableRoles(source, roleIds) {
  const me = source.guild.members.me;
  if (!me?.permissions?.has(PermissionFlagsBits.ManageRoles)) {
    await replyEphemeral(source, '🚫 I can’t manage roles — grant CuffBot the **Manage Roles** permission.');
    return false;
  }
  for (const id of roleIds.filter(Boolean)) {
    const role = source.guild.roles.cache.get(id);
    if (role && role.editable === false) {
      await replyEphemeral(
        source,
        `🚫 The **${role.name}** role sits at or above my highest role, so I can’t assign it. Move the CuffBot role higher in Server Settings → Roles.`,
      );
      return false;
    }
  }
  return true;
}

/** Apply a validated rank-change plan: remove other rank roles, add the target. */
export async function applyRankChange(member, plan, actorName) {
  const reason = auditReason(`rank change by ${actorName}`, actorName);
  if (plan.removeRoleIds.length > 0) await member.roles.remove(plan.removeRoleIds, reason);
  if (plan.addRoleId) await member.roles.add(plan.addRoleId, reason);
}

/** Translate a plan failure code into a specific, in-theme reply. */
export function planErrorMessage(plan, target) {
  switch (plan.code) {
    case 'ladder-unconfigured':
      return '🚫 No rank ladder detected. An admin can point me at the header role with `!ranks setup header:@[LEVELER]`, then `!ranks` to verify.';
    case 'already-top':
      return `🚫 ${target} is already **${plan.current}** — the top of the ladder.`;
    case 'already-bottom':
      return `🚫 ${target} is already **${plan.current}** — the bottom of the ladder.`;
    case 'no-rank-to-demote':
      return `🚫 ${target} holds no rank, so there is nothing to demote.`;
    case 'target-not-higher':
      return `🚫 ${target} is already **${plan.current}**; that target is not a promotion. Use !demote to move down.`;
    case 'target-not-lower':
      return `🚫 ${target} is **${plan.current}**; that target is not a demotion. Use !promote to move up.`;
    case 'unknown-rank':
      return '🚫 That role is not one of the ranks. Run `!ranks` to see the ladder.';
    default:
      return '🚫 Could not change rank.';
  }
}
