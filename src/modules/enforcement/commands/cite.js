// S94 (M17.3 slice B): converted to the flat { command } shape.
//
// The penalty used to be slash-only: two free-text fields cannot be split
// positionally, and the adapter could make only ONE of them greedy. It is
// reachable from text for the first time since S68 via the framework's
// `name:value` keyword args (S94) — `!cite @x loud music penalty:FINAL
// WARNING`.
import { AttachmentBuilder, PermissionFlagsBits } from 'discord.js';
import { renderCitationGif } from '../lib/citation-card.js';
import { ensureSensibleTarget } from '../guards.js';
import { addRecord } from '../../records/lib/api.js';
import { logEnforcement } from '../../dispatch/lib/api.js';
import { logger } from '../../../core/logger.js';

export default {
  command: {
    name: 'cite',
    description: 'Issue a formal citation (warning) — delivered as a Papers-Please-style ticket.',
    emoji: '📋',
    permission: PermissionFlagsBits.ModerateMembers,
    args: [
      { name: 'target', type: 'user', required: true },
      { name: 'reason', type: 'string', required: true, greedy: true, maxLength: 300 },
      { name: 'penalty', type: 'string', maxLength: 100 }, // penalty:FINAL WARNING
    ],
    async run(ctx, { target, reason, penalty }) {
      if (!(await ensureSensibleTarget(ctx, target))) return;

      const { gif } = renderCitationGif({
        to: target.displayName ?? target.username,
        reason,
        penalty,
        officer: ctx.user.displayName ?? ctx.user.username,
        date: new Date().toISOString().slice(0, 10),
        badgeSeed: target.id,
      });

      // File the case before announcing it, so the reply can carry the number.
      // Records being unavailable must never block a citation (see
      // architecture.md → Cross-module calls).
      let caseNumber = null;
      try {
        caseNumber = addRecord(ctx.guild.id, {
          type: 'citation',
          userId: target.id,
          officerId: ctx.user.id,
          reason,
          meta: penalty ? { penalty } : {},
        }).caseNumber;
      } catch (error) {
        logger.warn('Records unavailable — citation not filed:', error);
      }

      await ctx.reply({
        content: `📋 Citation issued to ${target}${caseNumber ? ` (Case #${caseNumber})` : ''}. Reason: ${reason}`,
        files: [new AttachmentBuilder(gif, { name: 'citation.gif' })],
        // Reason is user text — only let the target ping, never @everyone/roles.
        allowedMentions: { users: [target.id] },
      });

      // Best-effort DM copy — closed DMs are common and not an error.
      const dmDelivered = await target
        .send({
          content: `📋 You received a citation in **${ctx.guild.name}**.`,
          files: [new AttachmentBuilder(gif, { name: 'citation.gif' })],
        })
        .then(() => true)
        .catch(() => false);
      if (!dmDelivered) {
        await ctx.reply('(No DM copy delivered — their DMs are closed.)');
      }

      try {
        await logEnforcement(ctx.guild, {
          type: 'citation',
          subject: `${target}`,
          officer: `${ctx.user}`,
          reason,
          caseNumber,
          fields: penalty ? [{ name: 'Penalty', value: penalty, inline: true }] : [],
        });
      } catch (error) {
        logger.warn('Evidence-locker log failed (citation):', error);
      }
    },
  },
};
