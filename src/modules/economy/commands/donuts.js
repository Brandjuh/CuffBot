// The donuts group (`!donuts`). S106 folded `!donuts board` in as `board`.
// Bare `!donuts` (and `!donuts @member`) still shows a balance — the fallback
// plus `invokeWithoutSubcommand` keep both invocations exactly as they were.
import { EmbedBuilder } from 'discord.js';
import { balanceOf, getEconomyConfig, topBalances } from '../service.js';

const MEDALS = ['🥇', '🥈', '🥉'];

export default {
  group: {
    name: 'donuts',
    aliases: ['donut-board'],
    description: 'Donut balances and the precinct rich list.',
    emoji: '🍩',
    fallback: 'balance',
    invokeWithoutSubcommand: true,
    subcommands: [
      {
        // S106: what bare `!donuts` and `!donuts @member` run.
        name: 'balance',
        aliases: ['bal', 'me'],
        description: 'Check a donut balance — yours, or another officer’s.',
        args: [{ name: 'member', type: 'user' }], // default: you
        async run(ctx, { member }) {

          const target = member ?? ctx.user;
          if (target.bot) {
            await ctx.reply('🤖 Bots run on electricity, not donuts.');
            return;
          }
          const config = getEconomyConfig(ctx.guild.id);
          const balance = balanceOf(ctx.guild.id, target.id);
          const whose = target.id === ctx.user.id ? 'You have' : `<@${target.id}> has`;
          await ctx.reply({
            content: `🍩 ${whose} **${balance.toLocaleString('en-US')} donuts**.${
              config.enabled ? '' : ' (The economy is currently disabled.)'
            }`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        // S106: was `!donuts board`.
        name: 'board',
        aliases: ['leaderboard', 'top', 'rich'],
        description: 'The precinct’s richest officers — top donut balances.',
        args: [{ name: 'top', type: 'integer', min: 1, max: 25 }], // default 10
        async run(ctx, { top = 10 }) {

          const rows = topBalances(ctx.guild.id, top);
          if (rows.length === 0) {
            await ctx.reply('🍩 Nobody has moved a single donut yet — get chatting (or catch a crook).');
            return;
          }
          const lines = rows.map(({ userId, balance }, i) => {
            const medal = MEDALS[i] ?? `**${i + 1}.**`;
            return `${medal} <@${userId}> — **${balance.toLocaleString('en-US')}** 🍩`;
          });
          const embed = new EmbedBuilder()
            .setColor(0xe67e22)
            .setTitle('🍩 Donut Board — Richest Officers')
            .setDescription(lines.join('\n'));
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
    ],
  },
};
