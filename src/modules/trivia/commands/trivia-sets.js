import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { loadSets } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('trivia-sets')
    .setDescription('List the installed trivia question sets.'),
  async execute(interaction) {
    const sets = [...loadSets().values()];
    const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('📚 Trivia Question Sets');
    embed.setDescription(
      sets.length === 0
        ? 'No sets installed. Drop a JSON file in `src/modules/trivia/data/` (see the manual) and redeploy.'
        : sets.map((s) => `**${s.title}** — \`${s.set}\`, ${s.questions.length} questions`).join('\n'),
    );
    embed.setFooter({ text: 'Play one with /trivia set:<id> · new sets are plain JSON files' });
    await interaction.reply({ embeds: [embed] });
  },
};
