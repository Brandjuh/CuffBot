// !steal (S40, cooldown S48, pot S41). S63 owner request: outcomes are short,
// clean embeds instead of run-on text — one bold fact per line.
//
// S95 (M17.3 slice C): converted to the flat { command } shape. The busted
// message pointed at `/crack-pot`, which has not existed since S68.
import { EmbedBuilder } from 'discord.js';
import { formatWaitMs } from '../lib/bank.js';
import { attemptHeist, getEconomyConfig } from '../service.js';

const gold = (n) => `${n.toLocaleString('en-US')} 🍩`;

export default {
  command: {
    name: 'steal',
    description:
      'Attempt to steal donuts from another officer (30% odds — get busted and you pay the pot).',
    emoji: '🕶️',
    args: [{ name: 'target', type: 'user', required: true }],
    async run(ctx, { target }) {
      if (target.bot) {
        await ctx.reply('🤖 Bots keep their donuts in the cloud — unstealable.');
        return;
      }

      const config = getEconomyConfig(ctx.guild.id);
      const result = attemptHeist(ctx.guild, ctx.user.id, target.id);
      const thief = ctx.member?.displayName ?? ctx.user.username;
      const victim = target.username;

      switch (result.code) {
        case 'disabled':
          await ctx.reply('🍩 The economy is currently disabled.');
          return;
        case 'self':
          await ctx.reply('🪞 Stealing from yourself is just moving donuts between pockets.');
          return;
        case 'cooldown':
          await ctx.reply(
            `🕶️ Lay low — the heat is still on. Next attempt in ~${formatWaitMs(result.waitMs)}.`,
          );
          return;
        case 'success': {
          const embed = new EmbedBuilder()
            .setColor(0x2ecc71)
            .setTitle('🕶️ HEIST!')
            .setDescription(
              result.amount > 0
                ? [
                    `**${thief}** slipped past **${victim}**.`,
                    `# +${gold(result.amount)}`,
                    ...(result.amount < config.heistAmount
                      ? ['_That was everything they carried._']
                      : []),
                  ].join('\n')
                : `**${thief}** picked **${victim}**’s pocket flawlessly… and found it empty.`,
            );
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
          return;
        }
        case 'failure':
        default: {
          const embed = new EmbedBuilder()
            .setColor(0xe74c3c)
            .setTitle('🚨 BUSTED!')
            .setDescription(
              result.amount > 0
                ? [
                    `**${thief}** got caught robbing **${victim}**.`,
                    `# −${gold(result.amount)}`,
                    `_Confiscated into the donut pot — now **${gold(result.potBalance)}**. Your shot: \`${ctx.prefix}crack-pot\`._`,
                  ].join('\n')
                : `**${thief}** got caught robbing **${victim}** — with already-empty pockets. The pot sighs.`,
            );
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        }
      }
    },
  },
};
