// S93 (M17.3 slice A): converted from the legacy { data, execute } shape to
// the flat { command } shape. Same invocation (`!rapsheet @member`), but the
// framework now owns the permission refusal and the crash apology, and the
// old MessageFlags.Ephemeral is gone — ctx.reply has been the S54 no-ping
// in-channel reply all along, which is what the adapter turned it into.
import { PermissionFlagsBits } from 'discord.js';
import { recordsFor } from '../lib/api.js';
import { formatRapSheet } from '../lib/format.js';

export default {
  command: {
    name: 'rapsheet',
    description: "Pull up a member's record: citations, detainments, arrests, releases.",
    emoji: '📋',
    permission: PermissionFlagsBits.ModerateMembers,
    args: [{ name: 'target', type: 'user', required: true }],
    async run(ctx, { target }) {
      const entries = recordsFor(ctx.guild.id, target.id);
      await ctx.reply(formatRapSheet(target.displayName ?? target.username, entries));
    },
  },
};
