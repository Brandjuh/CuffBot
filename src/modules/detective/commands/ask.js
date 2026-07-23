import { SlashCommandBuilder } from 'discord.js';
import { askDetective } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the precinct detective (AI) a question.')
    .addStringOption((option) =>
      option.setName('question').setDescription('What do you want to know?').setRequired(true),
    ),
  // Free-text field for `!ask how do sirens work` — absorbs the whole line.
  textGreedyArg: 'question',
  async execute(interaction) {
    const question = interaction.options.getString('question', true);
    // Provider calls take seconds; the 3-second interaction window does not.
    await interaction.deferReply();
    const result = await askDetective({
      guildId: interaction.guild.id,
      channelId: interaction.channel?.id ?? 'dm',
      askerName: interaction.member?.displayName ?? interaction.user.username,
      question,
    });
    await interaction.editReply({
      content: result.ok ? `🕵️ ${result.reply}` : result.message,
      allowedMentions: { parse: [] },
    });
  },
};
