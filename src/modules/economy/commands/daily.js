// S95 (M17.3 slice C): converted to the flat { command } shape.
import { formatWaitMs } from '../lib/bank.js';
import { claimDaily } from '../service.js';

export default {
  command: {
    name: 'daily',
    description: 'Collect your daily donut ration — once every 24 hours.',
    emoji: '🍩',
    args: [],
    async run(ctx) {
      const result = claimDaily(ctx.guild.id, ctx.user.id);
      switch (result.code) {
        case 'disabled':
          await ctx.reply('🍩 The economy is currently disabled.');
          return;
        case 'cooldown':
          await ctx.reply(
            `⏳ You already collected today’s ration. The next batch is fresh in **~${formatWaitMs(result.waitMs)}**.`,
          );
          return;
        case 'claimed':
        default:
          await ctx.reply(
            `🍩 **Daily ration collected: +${result.amount} donuts!** Balance: **${result.balance.toLocaleString('en-US')}** 🍩. Come back in 24 hours.`,
          );
      }
    },
  },
};
