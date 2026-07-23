import { SlashCommandBuilder } from 'discord.js';
import { describeLatency } from '../lib/radio.js';

export default {
  data: new SlashCommandBuilder()
    .setName('radio-check')
    .setDescription('Check that CuffBot is on the air (round-trip latency).'),
  async execute(interaction) {
    const sent = await interaction.reply({ content: '📻 Radio check…', withResponse: true });
    const latency =
      sent.resource.message.createdTimestamp - interaction.createdTimestamp;
    await interaction.editReply(describeLatency(latency));
  },
};
