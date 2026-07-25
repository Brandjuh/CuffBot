// S93 (M17.3 slice A): converted to the flat { command } shape. The old
// per-command `textGreedyArg` hint is gone — the framework now understands a
// greedy arg with specs after it, so `!911 @member they spammed the lobby yes`
// still finds the trailing anonymity flag, and a reason ending in an ordinary
// word still reads as part of the reason.
import { reportEmbed } from '../lib/cards.js';
import { sendToEvidenceLocker } from '../../dispatch/lib/api.js';
import { logger } from '../../../core/logger.js';

export default {
  command: {
    name: '911',
    description: 'Report a member to the force. The report goes to the evidence locker.',
    emoji: '🚨',
    args: [
      { name: 'target', type: 'user', required: true },
      { name: 'reason', type: 'string', required: true, greedy: true, maxLength: 500 },
      { name: 'anonymous', type: 'boolean' }, // hide your name (default: false)
    ],
    async run(ctx, { target, reason, anonymous = false }) {
      const embed = reportEmbed({
        targetLabel: `${target}`,
        targetId: target.id,
        reason,
        reporterLabel: `${ctx.user}`,
        anonymous,
      });

      let result = { delivered: false, reason: 'not-configured' };
      try {
        result = await sendToEvidenceLocker(ctx.guild, embed);
      } catch (error) {
        logger.warn('911: could not deliver report:', error);
      }

      // Answer the reporter, never echo the report itself into the channel.
      await ctx.reply(
        result.delivered
          ? '🚨 Report filed with the force. Thank you — an officer will review it.'
          : '🚨 Report received, but there is no evidence-locker channel configured, so the force may not see it. Ask an admin to run `!evidence-locker action:set`.',
      );
    },
  },
};
