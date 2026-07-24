import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { topBalances } from '../service.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export default {
  data: new SlashCommandBuilder()
    .setName('donut-board')
    .setDescription('The precinct’s richest officers — top donut balances.')
    .addIntegerOption((o) =>
      o.setName('top').setDescription('How many to show (1–25, default 10)').setMinValue(1).setMaxValue(25),
    ),
  async execute(interaction) {
    const limit = interaction.options.getInteger('top') ?? 10;
    const rows = topBalances(interaction.guild.id, limit);
    if (rows.length === 0) {
      await interaction.reply({
        content: '🍩 Nobody has moved a single donut yet — get chatting (or catch a crook).',
        flags: 64,
        textInChannel: true,
      });
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
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
