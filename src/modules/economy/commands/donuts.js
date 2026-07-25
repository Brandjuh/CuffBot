// S95 (M17.3 slice C): converted to the flat { command } shape. `member:@x`
// works as well as a bare mention — the manual advertises the keyword form.
import { balanceOf, getEconomyConfig } from '../service.js';

export default {
  command: {
    name: 'donuts',
    description: 'Check a donut balance — yours, or another officer’s.',
    emoji: '🍩',
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
};
