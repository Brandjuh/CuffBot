// S93 (M17.3 slice A): converted to the flat { command } shape. The old
// deferReply()/editReply() pair is gone: a text command has no 3-second
// deadline, so rendering shows the typing indicator and posts the finished
// poster once — no "🚔 Working…" placeholder to edit away.
import { AttachmentBuilder } from 'discord.js';
import { pickBounty, pickCrime } from '../lib/cards.js';
import { renderWantedPoster } from '../lib/poster.js';
import { fetchAvatarRgb } from '../lib/png-decode.js';

export default {
  command: {
    name: 'wanted',
    description:
      'Put up a real WANTED poster for a member — with their photo in the middle (just for fun).',
    emoji: '🤠',
    args: [
      { name: 'target', type: 'user', required: true },
      { name: 'crime', type: 'string', greedy: true, maxLength: 150 }, // default: a random one
    ],
    async run(ctx, { target, crime: allegedCrime }) {
      await ctx.typing();
      const member = await ctx.guild.members.fetch(target.id).catch(() => null);
      const crime = allegedCrime ?? pickCrime(target.id);

      // Request the avatar as a static PNG so the pure decoder can read it; a
      // failed/absent avatar falls back to a NO PHOTO placeholder.
      const url = target.displayAvatarURL?.({ extension: 'png', forceStatic: true, size: 512 }) ?? null;
      const avatar = url ? await fetchAvatarRgb(url) : null;

      const { png } = renderWantedPoster({
        displayName: member?.displayName ?? target.username,
        crime,
        bounty: pickBounty(target.id),
        avatar,
      });
      await ctx.reply({
        content: `${target}`,
        files: [new AttachmentBuilder(png, { name: 'wanted.png' })],
      });
    },
  },
};
