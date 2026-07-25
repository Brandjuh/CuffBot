// S95 (M17.3 slice C): converted to the flat { command } shape. The provider
// call takes seconds, which used to need deferReply()/editReply() to beat the
// 3-second interaction window — a message command has no such window, so it
// shows the typing indicator and answers once.
import { askDetective, getAiConfig } from '../service.js';

export default {
  command: {
    name: 'ask',
    description: 'Ask the precinct detective (AI) a question.',
    emoji: '🕵️',
    // Greedy: `!ask how do sirens work` absorbs the whole line. The manual
    // also advertises `!ask question:…`, which the keyword form covers.
    args: [{ name: 'question', type: 'string', required: true, greedy: true }],
    async run(ctx, { question }) {
      // S51: the detective has ONE desk — questions outside it are redirected
      // before any budget is spent.
      const config = getAiConfig(ctx.guild.id);
      if (config.channelId && ctx.channel?.id !== config.channelId) {
        await ctx.reply({
          content: `🕵️ The detective only takes questions at his desk: <#${config.channelId}>. Ask me there!`,
          allowedMentions: { parse: [] },
        });
        return;
      }

      await ctx.typing();
      const result = await askDetective({
        guildId: ctx.guild.id,
        channelId: ctx.channel?.id ?? 'dm',
        askerName: ctx.member?.displayName ?? ctx.user.username,
        question,
        userId: ctx.user.id,
      });
      await ctx.reply({
        content: result.ok ? `🕵️ ${result.reply}` : result.message,
        allowedMentions: { parse: [] },
      });
    },
  },
};
