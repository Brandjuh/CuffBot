// S94 (M17.3 slice B): converted to the flat { command } shape. The gate is
// Moderate Members, but lifting a BAN is a bigger power than lifting a
// timeout, so that branch still re-checks Ban Members at runtime — the
// framework can only gate the command as a whole.
import { PermissionFlagsBits } from 'discord.js';
import { auditReason } from '../lib/audit.js';
import { fetchMember } from '../guards.js';
import { hasPermission } from '../../../core/prefix/permissions.js';
import { addRecord } from '../../records/lib/api.js';
import { logEnforcement } from '../../dispatch/lib/api.js';
import { logger } from '../../../core/logger.js';

function fileRelease(ctx, target, reason, released) {
  try {
    return addRecord(ctx.guild.id, {
      type: 'release',
      userId: target.id,
      officerId: ctx.user.id,
      reason,
      meta: { released },
    }).caseNumber;
  } catch (error) {
    logger.warn('Records unavailable — release not filed:', error);
    return null;
  }
}

async function logRelease(ctx, target, reason, released, caseNumber) {
  try {
    await logEnforcement(ctx.guild, {
      type: 'release',
      subject: `${target}`,
      officer: `${ctx.user}`,
      reason,
      caseNumber,
      fields: [{ name: 'Released from', value: released, inline: true }],
    });
  } catch (error) {
    logger.warn('Evidence-locker log failed (release):', error);
  }
}

export default {
  command: {
    name: 'release',
    description: 'Release someone: lift a timeout, or lift a ban.',
    emoji: '🔓',
    permission: PermissionFlagsBits.ModerateMembers,
    args: [
      { name: 'target', type: 'user', required: true },
      { name: 'reason', type: 'string', greedy: true, maxLength: 400 },
    ],
    async run(ctx, { target, reason = null }) {
      const audit = auditReason(reason, ctx.user.username);

      // Path 1: member present with an active timeout → lift it.
      const member = await fetchMember(ctx, target.id);
      if (member) {
        const detainedUntil = member.communicationDisabledUntilTimestamp;
        if (detainedUntil && detainedUntil > Date.now()) {
          if (!member.moderatable) {
            await ctx.reply(
              `🚫 Cannot release ${target}: their highest role is at or above mine.`,
            );
            return;
          }
          await member.timeout(null, audit);
          const caseNumber = fileRelease(ctx, target, reason, 'timeout');
          await ctx.reply(
            `🔓 ${target} released from the holding cell (timeout lifted)${caseNumber ? ` — Case #${caseNumber}` : ''}.`,
          );
          await logRelease(ctx, target, reason, 'timeout', caseNumber);
          return;
        }
      }

      // Path 2: banned → unban. Lifting a ban is a bigger power than lifting a
      // timeout, so it demands the invoker's Ban Members permission.
      const ban = await ctx.guild.bans.fetch(target.id).catch(() => null);
      if (ban) {
        if (!hasPermission(ctx, PermissionFlagsBits.BanMembers)) {
          await ctx.reply('🚫 Lifting a ban requires the **Ban Members** permission.');
          return;
        }
        await ctx.guild.members.unban(target.id, audit);
        const caseNumber = fileRelease(ctx, target, reason, 'ban');
        await ctx.reply(
          `🔓 ${target} released — ban lifted${caseNumber ? ` (Case #${caseNumber})` : ''}. They may rejoin the precinct.`,
        );
        await logRelease(ctx, target, reason, 'ban', caseNumber);
        return;
      }

      await ctx.reply(`${target} is neither detained nor arrested — nothing to release.`);
    },
  },
};
