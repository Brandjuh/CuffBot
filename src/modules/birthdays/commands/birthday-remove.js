import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { removeBirthday } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('birthday-remove')
    .setDescription('Remove your stored birthday (no more announcements).'),
  async execute(interaction) {
    const existed = removeBirthday(interaction.guild.id, interaction.user.id);
    await interaction.reply({
      content: existed
        ? '🗑️ Your birthday has been struck from the record. No cake, no candles, no announcement.'
        : 'ℹ️ There was no birthday on file for you.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
