// S96 (M17.3 slice D): converted to the flat { command } shape.
//
// The latency measurement is the one place the old two-step reply earned its
// keep: it timed the gap between the invocation and the bot's own answer.
// ctx.reply returns the sent Message, so the same measurement now works
// against `message.createdTimestamp` — and the reply is edited in place
// rather than posted twice.
import { describeLatency } from '../lib/radio.js';

export default {
  command: {
    name: 'radio-check',
    description: 'Check that CuffBot is on the air (latency + feature status).',
    emoji: '📻',
    args: [],
    async run(ctx) {
      const sent = await ctx.reply('📻 Radio check…');
      const latency = (sent?.createdTimestamp ?? 0) - (ctx.message?.createdTimestamp ?? 0);

      // Surface the text-command state right where members would notice it:
      // without the Message Content intent the bot cannot READ "!" commands at
      // all, and that silence would otherwise look like a broken bot.
      const textStatus = ctx.client.messageContentAvailable
        ? `✅ Text commands (\`${ctx.prefix}help\`) are on the air.`
        : `❌ ALL commands are OFF: CuffBot is text-only (S68) and the **Message Content Intent** is disabled in the Developer Portal (Bot → Privileged Gateway Intents). Enable it + restart.`;
      const memberStatus = ctx.client.memberEventsAvailable
        ? '✅ Member events (welcome, join/leave logs) are on the air.'
        : `❌ Member events are OFF: the **Server Members Intent** is disabled in the Developer Portal — no welcome messages, no join/leave/role logs. Enable it + \`${ctx.prefix}restart\`.`;

      const body = `${describeLatency(latency)}\n${textStatus}\n${memberStatus}`;
      if (typeof sent?.edit === 'function') await sent.edit(body);
      else await ctx.reply(body);
    },
  },
};
