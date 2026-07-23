import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { leaderboard } from '../service.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export default {
  data: new SlashCommandBuilder()
    .setName('leaderboard')
    .setDescription('Top of the force: the precinct XP leaderboard.')
    .addIntegerOption((option) =>
      option
        .setName('size')
        .setDescription('How many officers to show (default 10, max 25)')
        .setMinValue(1)
        .setMaxValue(25),
    ),
  async execute(interaction) {
    const size = interaction.options.getInteger('size') ?? 10;
    const top = leaderboard(interaction.guild.id, size);

    const embed = new EmbedBuilder().setColor(0xd4a24e).setTitle('🏆 Precinct Leaderboard');
    if (top.length === 0) {
      embed.setDescription(
        'No XP on the books yet. XP starts flowing as members chat and spend time in voice.',
      );
    } else {
      embed.setDescription(
        top
          .map((row, i) => {
            const place = MEDALS[i] ?? `**${i + 1}.**`;
            return `${place} <@${row.userId}> — ${row.xp.toLocaleString('en-US')} XP`;
          })
          .join('\n'),
      );
      embed.setFooter({ text: 'Message + voice activity both count. /level shows your own card.' });
    }
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
