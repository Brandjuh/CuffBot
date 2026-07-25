// S95 (M17.3 slice C): converted to the flat { command } shape. The footer
// pointed at `/trivia set:<id>`, gone since S68.
import { EmbedBuilder } from 'discord.js';
import { loadSets } from '../service.js';

export default {
  command: {
    name: 'trivia-sets',
    description: 'List the installed trivia question sets.',
    emoji: '📚',
    args: [],
    async run(ctx) {
      const sets = [...loadSets().values()];
      const embed = new EmbedBuilder().setColor(0xf1c40f).setTitle('📚 Trivia Question Sets');
      embed.setDescription(
        sets.length === 0
          ? 'No sets installed. Drop a JSON file in `src/modules/trivia/data/` (see the manual) and redeploy.'
          : sets.map((s) => `**${s.title}** — \`${s.set}\`, ${s.questions.length} questions`).join('\n'),
      );
      embed.setFooter({
        text: `Play one with ${ctx.prefix}trivia <set> · new sets are plain JSON files`,
      });
      await ctx.reply({ embeds: [embed] });
    },
  },
};
