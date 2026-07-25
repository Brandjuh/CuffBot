// S93 (M17.3 slice A): converted to the flat { command } shape. resolveLadder
// only ever reads `.guild`, which ctx carries, so the academy seam is unchanged.
import { EmbedBuilder } from 'discord.js';
import { badgeEmbed } from '../lib/cards.js';
import { resolveLadder } from '../../academy/service.js';
import { currentRank } from '../../academy/lib/ladder.js';
import { recordsFor } from '../../records/lib/api.js';
import { logger } from '../../../core/logger.js';

export default {
  command: {
    name: 'badge',
    description: 'Show a member’s badge: rank, record count, and time on the force.',
    emoji: '🪪',
    args: [{ name: 'target', type: 'user' }], // default: you
    async run(ctx, { target: requested }) {
      const target = requested ?? ctx.user;
      const member = await ctx.guild.members.fetch(target.id).catch(() => null);

      // Rank and record are best-effort — a missing/broken module must not
      // break !badge (the S8 cross-module rule: degrade, never block).
      let rankName = null;
      try {
        if (member) {
          const ladder = resolveLadder(ctx);
          rankName = currentRank([...member.roles.cache.keys()], ladder)?.name ?? null;
        }
      } catch (error) {
        logger.warn('Badge: rank lookup failed:', error);
      }
      let recordCount = 0;
      try {
        recordCount = recordsFor(ctx.guild.id, target.id).length;
      } catch (error) {
        logger.warn('Badge: record lookup failed:', error);
      }

      const data = badgeEmbed({
        displayName: member?.displayName ?? target.username,
        joinedTimestamp: member?.joinedTimestamp ?? null,
        rankName,
        recordCount,
        avatarURL: target.displayAvatarURL?.() ?? null,
      });
      await ctx.reply({ embeds: [EmbedBuilder.from(data)] });
    },
  },
};
