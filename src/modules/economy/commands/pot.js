// The donut-pot group (`!pot`). S106 folded `!pot crack` in as `crack`.
// Bare `!pot` still shows the pot.
import { EmbedBuilder } from 'discord.js';
import { getPot, hasPotTryToday, tryPot } from '../service.js';

const gold = (n) => `${n.toLocaleString('en-US')} 🍩`;

export default {
  group: {
    name: 'pot',
    aliases: ['crack-pot'],
    description: 'The donut pot: what is in it, and your daily attempt to crack it.',
    emoji: '🍩',
    fallback: 'show',
    invokeWithoutSubcommand: true,
    subcommands: [
      {
        // S106: what bare `!pot` runs.
        name: 'show',
        aliases: ['status', 'view'],
        description: 'The donut pot: how much is in it, and whether your daily crack attempt is still open.',
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
                    : `✅ still open: \`${ctx.prefix}pot crack\``
                }`,
                '**The odds** — 0.5%. Winner takes the whole pot.',
              ].join('\n'),
            );
          await ctx.reply({ embeds: [embed] });
        },
      },
      {
        // S106: was `!pot crack`.
        name: 'crack',
        aliases: ['crack-pot', 'attempt'],
        description: 'Take your one daily shot at cracking the donut pot open (0.5% — winner takes all).',
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
    ],
  },
};
