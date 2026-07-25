// S94 (M17.3 slice B): converted to the flat { command } shape. The `wipe`
// choice list is a keyword arg (`wipe:24h`) rather than a positional one —
// the reason is greedy and a bare value after it would be ambiguous.
import { PermissionFlagsBits } from 'discord.js';
import { auditReason } from '../lib/audit.js';
import { ensureSensibleTarget, fetchMember, replyHierarchyBlocked } from '../guards.js';
import { addRecord } from '../../records/lib/api.js';
import { logEnforcement } from '../../dispatch/lib/api.js';
import { logger } from '../../../core/logger.js';

// Discord accepts 0..604800 seconds (7 days) of message history deletion.
// The keys are what an officer types after `wipe:`.
export const WIPE_CHOICES = [
  { key: 'none', name: 'Keep all messages', value: 0 },
  { key: '1h', name: 'last hour', value: 3_600 },
  { key: '6h', name: 'last 6 hours', value: 21_600 },
  { key: '24h', name: 'last 24 hours', value: 86_400 },
  { key: '3d', name: 'last 3 days', value: 259_200 },
  { key: '7d', name: 'last 7 days', value: 604_800 },
];

export default {
  command: {
    name: 'arrest',
    description: 'Arrest a member (ban). Works by id even if they already left.',
    emoji: '🚨',
    permission: PermissionFlagsBits.BanMembers,
    args: [
      { name: 'target', type: 'user', required: true },
      { name: 'reason', type: 'string', greedy: true, maxLength: 400 },
      {
        name: 'wipe', // wipe:24h — how much recent history to remove
        type: 'string',
        choices: WIPE_CHOICES.map((c) => c.key),
      },
    ],
    async run(ctx, { target, reason = null, wipe: wipeKey }) {
      if (!(await ensureSensibleTarget(ctx, target))) return;

      const wipe = wipeKey ? WIPE_CHOICES.find((c) => c.key === wipeKey) : null;

      // Hierarchy only applies when they are still a member; banning a user who
      // already left is a ban by id and always allowed for the bot.
      const member = await fetchMember(ctx, target.id);
      if (member && !member.bannable) {
        await replyHierarchyBlocked(ctx, target);
        return;
      }

      const alreadyBanned = await ctx.guild.bans.fetch(target.id).catch(() => null);
      if (alreadyBanned) {
        await ctx.reply(`${target} is already under arrest (banned).`);
        return;
      }

      const deleteMessageSeconds = wipe?.value ?? 0;
      await ctx.guild.members.ban(target.id, {
        reason: auditReason(reason, ctx.user.username),
        deleteMessageSeconds,
      });

      let caseNumber = null;
      try {
        caseNumber = addRecord(ctx.guild.id, {
          type: 'arrest',
          userId: target.id,
          officerId: ctx.user.id,
          reason,
          meta: { wipeSeconds: deleteMessageSeconds },
        }).caseNumber;
      } catch (error) {
        logger.warn('Records unavailable — arrest not filed:', error);
      }

      const wipeLabel = deleteMessageSeconds > 0 ? wipe.name : '';
      const wipeNote = wipeLabel ? ` Message history wiped: ${wipeLabel}.` : '';
      await ctx.reply({
        content: `🚨 ${target} has been **arrested** (banned)${caseNumber ? ` — Case #${caseNumber}` : ''}. Reason: ${reason ?? 'No reason given'}.${wipeNote}`,
        allowedMentions: { users: [target.id] },
      });

      try {
        await logEnforcement(ctx.guild, {
          type: 'arrest',
          subject: `${target}`,
          officer: `${ctx.user}`,
          reason,
          caseNumber,
          fields: wipeLabel ? [{ name: 'Message wipe', value: wipeLabel, inline: true }] : [],
        });
      } catch (error) {
        logger.warn('Evidence-locker log failed (arrest):', error);
      }
    },
  },
};
