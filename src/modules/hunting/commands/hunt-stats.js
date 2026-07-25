// S93 (M17.3 slice A): converted to the flat { command } shape.
import { EmbedBuilder } from 'discord.js';
import { CROOKS } from '../lib/hunt.js';
import { getScores } from '../service.js';

export default {
  command: {
    name: 'hunt-stats',
    description: 'A hunter’s arrest record: catches per crook type.',
    emoji: '🚔',
    args: [{ name: 'member', type: 'user' }], // default: you
    async run(ctx, { member }) {
      const target = member ?? ctx.user;
      const record = getScores(ctx.guild.id)[target.id];
      if (!record?.total) {
        await ctx.reply(
          '🦹 Cuff a crook before you brag about it — shout **STOP POLICE** when one appears.',
        );
        return;
      }
      const lines = CROOKS.filter((c) => record.byCrook?.[c.id]).map(
        (c) => `${c.emoji} ${c.id.replace(/-/g, ' ')} — **${record.byCrook[c.id]}**`,
      );
      const embed = new EmbedBuilder()
        .setColor(0x1f8b4c)
        .setTitle(`🚔 Arrest record — ${target.username}`)
        .setDescription(
          [`**${record.total}** crook${record.total === 1 ? '' : 's'} cuffed in total`, '', ...lines].join('\n'),
        );
      await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },
};
