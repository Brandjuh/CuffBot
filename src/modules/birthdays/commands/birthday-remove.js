// S94 (M17.3 slice B): converted to the flat { command } shape.
import { removeBirthday } from '../service.js';

export default {
  command: {
    name: 'birthday-remove',
    description: 'Remove your stored birthday (no more announcements).',
    emoji: '🗑️',
    args: [],
    async run(ctx) {
      const existed = removeBirthday(ctx.guild.id, ctx.user.id);
      await ctx.reply(
        existed
          ? '🗑️ Your birthday has been struck from the record. No cake, no candles, no announcement.'
          : 'ℹ️ There was no birthday on file for you.',
      );
    },
  },
};
