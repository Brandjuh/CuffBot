// The pot VIEW (S63 owner request: the old text wall read as clutter, and
// `!pot try:True` was clunky). Viewing and cracking are two commands:
// !pot shows the state, !crack-pot takes the daily shot.
//
// S95 (M17.3 slice C): converted to the flat { command } shape.
import { EmbedBuilder } from 'discord.js';
import { getPot, hasPotTryToday } from '../service.js';

export default {
  command: {
    name: 'pot',
    description:
      'The donut pot: how much is in it, and whether your daily crack attempt is still open.',
    emoji: '🍯',
    args: [],
    async run(ctx) {
      const pot = getPot(ctx.guild.id);
      const tried = hasPotTryToday(ctx.guild.id, ctx.user.id);
      const embed = new EmbedBuilder()
        .setColor(0xf1c40f)
        .setTitle('🍯 The Donut Pot')
        .setDescription(
          [
            `# ${pot.balance.toLocaleString('en-US')} 🍩`,
            '',
            `**How it fills** — busted \`${ctx.prefix}steal\` attempts, escaped crooks, and **+500** 🍩 every day.`,
            `**Your daily shot** — ${
              tried
                ? '❌ used for today (new chance after midnight UTC)'
                : `✅ still open: \`${ctx.prefix}crack-pot\``
            }`,
            '**The odds** — 0.5%. Winner takes the whole pot.',
          ].join('\n'),
        );
      await ctx.reply({ embeds: [embed] });
    },
  },
};
