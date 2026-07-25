// The daily pot attempt as its own command (S63 owner request — replaces the
// clunky `!pot try:True`). Outcomes are short, clean embeds: the win is loud,
// the loss is one line.
//
// S95 (M17.3 slice C): converted to the flat { command } shape.
import { EmbedBuilder } from 'discord.js';
import { tryPot } from '../service.js';

const gold = (n) => `${n.toLocaleString('en-US')} 🍩`;

export default {
  command: {
    name: 'crack-pot',
    description:
      'Take your one daily shot at cracking the donut pot open (0.5% — winner takes all).',
    emoji: '💥',
    args: [],
    async run(ctx) {
      const who = ctx.member?.displayName ?? ctx.user.username;
      const result = tryPot(ctx.guild.id, ctx.user.id);

      if (result.code === 'disabled') {
        await ctx.reply('🍩 The economy is currently disabled.');
        return;
      }
      if (result.code === 'already') {
        await ctx.reply('🍯 You already took today’s shot — new chance after midnight UTC.');
        return;
      }

      const embed =
        result.code === 'win'
          ? new EmbedBuilder()
              .setColor(0x2ecc71)
              .setTitle('💥 JACKPOT!')
              .setDescription(
                `**${who}** cracked the pot wide open!\n# +${gold(result.amount)}\nThe pot starts over at zero.`,
              )
          : new EmbedBuilder()
              .setColor(0xf1c40f)
              .setTitle('🍯 The pot doesn’t budge')
              .setDescription(
                `**${who}** rattles it… nothing. **${gold(result.balance)}** stays locked. Tomorrow is a new day.`,
              );
      await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },
};
