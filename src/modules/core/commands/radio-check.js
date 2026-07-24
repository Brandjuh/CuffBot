import { SlashCommandBuilder } from 'discord.js';
import { describeLatency } from '../lib/radio.js';

export default {
  data: new SlashCommandBuilder()
    .setName('radio-check')
    .setDescription('Check that CuffBot is on the air (latency + feature status).'),
  async execute(interaction) {
    const sent = await interaction.reply({ content: '📻 Radio check…', withResponse: true });
    const latency =
      sent.resource.message.createdTimestamp - interaction.createdTimestamp;
    // Surface the text-command state right where members would notice it:
    // without the Message Content intent the bot cannot READ "!" commands at
    // all, and that silence would otherwise look like a broken bot.
    const textStatus = interaction.client.messageContentAvailable
      ? '✅ Text commands (`!help`) are on the air.'
      : '❌ Text commands are OFF: the **Message Content Intent** is disabled in the Developer Portal (Bot → Privileged Gateway Intents). Enable it + restart; slash commands work normally meanwhile.';
    await interaction.editReply(`${describeLatency(latency)}\n${textStatus}`);
  },
};
