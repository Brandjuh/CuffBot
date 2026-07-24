import { SlashCommandBuilder } from 'discord.js';
import { askDetective, getAiConfig } from '../service.js';

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
    // S51: the detective has ONE desk — questions outside it are redirected
    // before any budget is spent.
    const config = getAiConfig(interaction.guild.id);
    if (config.channelId && interaction.channel?.id !== config.channelId) {
      await interaction.reply({
        content: `🕵️ The detective only takes questions at his desk: <#${config.channelId}>. Ask me there!`,
        flags: 64,
      });
      return;
    }
    // Provider calls take seconds; the 3-second interaction window does not.
    await interaction.deferReply();
    const result = await askDetective({
      guildId: interaction.guild.id,
      channelId: interaction.channel?.id ?? 'dm',
      askerName: interaction.member?.displayName ?? interaction.user.username,
      question,
      userId: interaction.user.id,
    });
    await interaction.editReply({
      content: result.ok ? `🕵️ ${result.reply}` : result.message,
      allowedMentions: { parse: [] },
    });
  },
};
