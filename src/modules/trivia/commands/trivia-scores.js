import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { scoreboard } from '../lib/game.js';
import { getScores } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('trivia-scores')
    .setDescription('Show the precinct trivia leaderboard.'),
  async execute(interaction) {
    const rows = scoreboard(getScores(interaction.guild.id), 10);
    const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('🏆 Trivia Leaderboard');
    embed.setDescription(
      rows.length === 0
        ? 'No points scored yet — start a round with `/trivia`.'
        : rows
            .map(({ userId, points }, i) => {
              const medal = ['🥇', '🥈', '🥉'][i] ?? `**${i + 1}.**`;
              return `${medal} <@${userId}> — ${points} point${points === 1 ? '' : 's'}`;
            })
            .join('\n'),
    );
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
