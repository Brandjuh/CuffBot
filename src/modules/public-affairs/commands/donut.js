// S93 (M17.3 slice A): converted to the flat { command } shape.
import { pickDonut } from '../lib/cards.js';

export default {
  command: {
    name: 'donut',
    description: 'Hand someone a donut from the break room. 🍩',
    emoji: '🍩',
    args: [{ name: 'target', type: 'user' }], // default: yourself
    async run(ctx, { target: requested }) {
      const target = requested ?? ctx.user;
      const donut = pickDonut(`${ctx.user.id}:${target.id}`);
      if (target.id === ctx.user.id) {
        await ctx.reply(`🍩 ${ctx.user} treats themselves to ${donut}. Well earned, officer.`);
      } else {
        await ctx.reply(`🍩 ${ctx.user} hands ${target} ${donut}.`);
      }
    },
  },
};
