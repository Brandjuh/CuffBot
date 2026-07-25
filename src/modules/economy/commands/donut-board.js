// S95 (M17.3 slice C): converted to the flat { command } shape.
import { EmbedBuilder } from 'discord.js';
import { topBalances } from '../service.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export default {
  command: {
    name: 'donut-board',
    description: 'The precinct’s richest officers — top donut balances.',
    emoji: '🍩',
    args: [{ name: 'top', type: 'integer', min: 1, max: 25 }], // default 10
    async run(ctx, { top = 10 }) {
      const rows = topBalances(ctx.guild.id, top);
      if (rows.length === 0) {
        await ctx.reply('🍩 Nobody has moved a single donut yet — get chatting (or catch a crook).');
        return;
      }
      const lines = rows.map(({ userId, balance }, i) => {
        const medal = MEDALS[i] ?? `**${i + 1}.**`;
        return `${medal} <@${userId}> — **${balance.toLocaleString('en-US')}** 🍩`;
      });
      const embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('🍩 Donut Board — Richest Officers')
        .setDescription(lines.join('\n'));
      await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },
};
