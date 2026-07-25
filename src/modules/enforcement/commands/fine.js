// The public, for-fun sibling of !cite: anyone can issue a joke citation. It
// changes NOTHING — no permissions, no records, no moderation action — it just
// prints the same animated ticket for laughs. Kept next to !cite so both share
// the one citation renderer.
//
// S94 (M17.3 slice B): converted to the flat { command } shape, and the
// penalty is reachable from text for the first time (`penalty:…`).
import { AttachmentBuilder } from 'discord.js';
import { renderCitationGif } from '../lib/citation-card.js';

export default {
  command: {
    name: 'fine',
    description: 'Issue a playful citation to anyone — just for laughs, no real consequences.',
    emoji: '🎟️',
    args: [
      { name: 'target', type: 'user', required: true },
      { name: 'reason', type: 'string', required: true, greedy: true, maxLength: 300 },
      { name: 'penalty', type: 'string', maxLength: 100 }, // penalty:PAY UP IN DONUTS
    ],
    async run(ctx, { target, reason, penalty = 'PAY UP IN DONUTS' }) {
      if (target.id === ctx.client.user.id) {
        await ctx.reply('🍩 Nice try — you cannot fine the police.');
        return;
      }

      const { gif } = renderCitationGif({
        to: target.displayName ?? target.username,
        reason,
        penalty,
        officer: ctx.user.displayName ?? ctx.user.username,
        date: new Date().toISOString().slice(0, 10),
        badgeSeed: target.id,
      });

      await ctx.reply({
        content: `🎟️ ${ctx.user} slapped ${target} with a citation — all in good fun. Reason: ${reason}`,
        files: [new AttachmentBuilder(gif, { name: 'citation.gif' })],
        // !fine is available to everyone and echoes user text — restrict pings
        // to the two people named, so it can't mass-ping @everyone/roles.
        allowedMentions: { users: [ctx.user.id, target.id] },
      });
    },
  },
};
