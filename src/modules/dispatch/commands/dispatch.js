// S95 (M17.3 slice C): converted to the flat { command } shape. The
// announcement goes to the channel and the invoker no longer gets a separate
// "📣 Dispatched." acknowledgement — on the text path that was a second
// message saying what the first one already showed.
import { PermissionFlagsBits } from 'discord.js';
import { announcementEmbed } from '../lib/format.js';

export default {
  command: {
    name: 'dispatch',
    description: 'Broadcast an announcement to the precinct (posted in this channel).',
    emoji: '📣',
    permission: PermissionFlagsBits.ManageMessages,
    args: [{ name: 'message', type: 'string', required: true, greedy: true, maxLength: 1800 }],
    async run(ctx, { message }) {
      const officer = ctx.user.displayName ?? ctx.user.username;
      await ctx.channel.send({ embeds: [announcementEmbed({ message, officer })] });
    },
  },
};
