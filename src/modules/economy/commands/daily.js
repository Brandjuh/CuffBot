import { SlashCommandBuilder } from 'discord.js';
import { formatWaitMs } from '../lib/bank.js';
import { claimDaily } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('daily')
    .setDescription('Collect your daily donut ration — once every 24 hours.'),
  async execute(interaction) {
    const result = claimDaily(interaction.guild.id, interaction.user.id);
    switch (result.code) {
      case 'disabled':
        await interaction.reply({ content: '🍩 The economy is currently disabled.', flags: 64, textInChannel: true });
        return;
      case 'cooldown':
        await interaction.reply({
          content: `⏳ You already collected today’s ration. The next batch is fresh in **~${formatWaitMs(result.waitMs)}**.`,
          flags: 64,
          textInChannel: true,
        });
        return;
      case 'claimed':
      default:
        await interaction.reply({
          content: `🍩 **Daily ration collected: +${result.amount} donuts!** Balance: **${result.balance.toLocaleString('en-US')}** 🍩. Come back in 24 hours.`,
          flags: 64,
          textInChannel: true,
        });
    }
  },
};
