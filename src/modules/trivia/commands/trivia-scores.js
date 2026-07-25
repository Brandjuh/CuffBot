// S95 (M17.3 slice C): converted to the flat { command } shape.
import { EmbedBuilder } from 'discord.js';
import { scoreboard } from '../lib/game.js';
import { getScores } from '../service.js';

export default {
  command: {
    name: 'trivia-scores',
    description: 'Show the precinct trivia leaderboard.',
    emoji: '🏆',
    args: [],
    async run(ctx) {
      const rows = scoreboard(getScores(ctx.guild.id), 10);
      const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('🏆 Trivia Leaderboard');
      embed.setDescription(
        rows.length === 0
          ? `No points scored yet — start a round with \`${ctx.prefix}trivia\`.`
          : rows
              .map(({ userId, points }, i) => {
                const medal = ['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`;
                return `${medal} <@${userId}> — ${points} point${points === 1 ? '' : 's'}`;
              })
              .join('\n'),
      );
      await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },
};
