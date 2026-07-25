// S94 (M17.3 slice B): converted to the flat { command } shape. Three
// positional args in the order they are spoken: who, how long, and why.
import { PermissionFlagsBits } from 'discord.js';
import { MAX_TIMEOUT_MS, formatDuration, parseDuration } from '../lib/duration.js';
import { auditReason } from '../lib/audit.js';
import { ensureSensibleTarget, fetchMember, replyHierarchyBlocked } from '../guards.js';
import { addRecord } from '../../records/lib/api.js';
import { logEnforcement } from '../../dispatch/lib/api.js';
import { logger } from '../../../core/logger.js';

export default {
  command: {
    name: 'detain',
    description: 'Put a member in the holding cell (timeout).',
    emoji: '🚔',
    permission: PermissionFlagsBits.ModerateMembers,
    args: [
      { name: 'target', type: 'user', required: true },
      { name: 'duration', type: 'string', required: true, maxLength: 20 }, // 10m, 2h, 7d, 1h30m
      { name: 'reason', type: 'string', greedy: true, maxLength: 400 },
    ],
    async run(ctx, { target, duration: rawDuration, reason = null }) {
      if (!(await ensureSensibleTarget(ctx, target))) return;

      const ms = parseDuration(rawDuration);
      if (ms === null) {
        await ctx.reply(
          `🚫 "${rawDuration}" is not a duration I understand. Use forms like \`10m\`, \`2h\`, \`7d\`, or \`1h30m\`.`,
        );
        return;
      }
      if (ms > MAX_TIMEOUT_MS) {
        await ctx.reply(
          `🚫 Discord caps timeouts at **28 days** — ${formatDuration(ms)} does not fit. For longer removal, consider \`${ctx.prefix}arrest\`.`,
        );
        return;
      }

      const member = await fetchMember(ctx, target.id);
      if (!member) {
        await ctx.reply(
          `🚫 ${target} is not in the precinct (not a member of this server), so there is nothing to detain.`,
        );
        return;
      }
      if (!member.moderatable) {
        await replyHierarchyBlocked(ctx, target);
        return;
      }

      await member.timeout(ms, auditReason(reason, ctx.user.username));

      let caseNumber = null;
      try {
        caseNumber = addRecord(ctx.guild.id, {
          type: 'detainment',
          userId: target.id,
          officerId: ctx.user.id,
          reason,
          meta: { durationMs: ms },
        }).caseNumber;
      } catch (error) {
        logger.warn('Records unavailable — detainment not filed:', error);
      }

      await ctx.reply({
        content: `🚔 ${target} detained in the holding cell for **${formatDuration(ms)}** (timeout)${caseNumber ? ` — Case #${caseNumber}` : ''}. Reason: ${reason ?? 'No reason given'}`,
        allowedMentions: { users: [target.id] },
      });

      try {
        await logEnforcement(ctx.guild, {
          type: 'detainment',
          subject: `${target}`,
          officer: `${ctx.user}`,
          reason,
          caseNumber,
          fields: [{ name: 'Duration', value: formatDuration(ms), inline: true }],
        });
      } catch (error) {
        logger.warn('Evidence-locker log failed (detainment):', error);
      }
    },
  },
};
