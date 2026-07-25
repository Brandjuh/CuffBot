import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { topHunters } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('hunt-board')
    .setDescription('The precinct’s top crook hunters (top 25 by total catches).'),
  async execute(interaction) {
    const top = topHunters(interaction.guild.id, 25);
    if (top.length === 0) {
      await interaction.reply({
        content: '🦹 Nobody has cuffed a crook yet — the board is wide open.',
        flags: 64,
      });
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
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
