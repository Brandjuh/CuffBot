import { SlashCommandBuilder } from 'discord.js';
import { balanceOf, getEconomyConfig } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('donuts')
    .setDescription('Check a donut balance — yours, or another officer’s.')
    .addUserOption((o) => o.setName('member').setDescription('Whose wallet to peek into (default: you)')),
  async execute(interaction) {
    const target = interaction.options.getUser('member') ?? interaction.user;
    if (target.bot) {
      await interaction.reply({ content: '🤖 Bots run on electricity, not donuts.', flags: 64 });
      return;
    }
    const config = getEconomyConfig(interaction.guild.id);
    const balance = balanceOf(interaction.guild.id, target.id);
    const whose = target.id === interaction.user.id ? 'You have' : `<@${target.id}> has`;
    await interaction.reply({
      content: `🍩 ${whose} **${balance.toLocaleString('en-US')} donuts**.${
        config.enabled ? '' : ' (The economy is currently disabled.)'
      }`,
      allowedMentions: { parse: [] },
    });
  },
};
