import { SlashCommandBuilder } from 'discord.js';
import { pickDonut } from '../lib/cards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('donut')
    .setDescription('Hand someone a donut from the break room. 🍩')
    .addUserOption((option) =>
      option.setName('target').setDescription('Who gets the donut (default: yourself)'),
    ),
  async execute(interaction) {
    const target = interaction.options.getUser('target') ?? interaction.user;
    const donut = pickDonut(`${interaction.user.id}:${target.id}`);
    if (target.id === interaction.user.id) {
      await interaction.reply(`🍩 ${interaction.user} treats themselves to ${donut}. Well earned, officer.`);
    } else {
      await interaction.reply(`🍩 ${interaction.user} hands ${target} ${donut}.`);
    }
  },
};
