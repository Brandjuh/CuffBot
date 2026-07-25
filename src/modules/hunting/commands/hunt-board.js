// S93 (M17.3 slice A): converted to the flat { command } shape.
import { EmbedBuilder } from 'discord.js';
import { topHunters } from '../service.js';

export default {
  command: {
    name: 'hunt-board',
    description: 'The precinct’s top crook hunters (top 25 by total catches).',
    emoji: '🏆',
    args: [],
    async run(ctx) {
      const top = topHunters(ctx.guild.id, 25);
      if (top.length === 0) {
        await ctx.reply('🦹 Nobody has cuffed a crook yet — the board is wide open.');
        return;
      }
      const medals = ['🥇', '🥈', '🥉'];
      const lines = top.map(
        (r, i) => `${medals[i] ?? `**${i + 1}.**`} <@${r.userId}> — **${r.total.toLocaleString('en-US')}**`,
      );
      const embed = new EmbedBuilder()
        .setColor(0x1f8b4c)
        .setTitle('🏆 Hunting Leaderboard')
        .setDescription(lines.join('\n'));
      await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },
};
