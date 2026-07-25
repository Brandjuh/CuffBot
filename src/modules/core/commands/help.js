// S96 (M17.3 slice D): converted to the flat { command } shape — the last
// legacy command in the bot, and the one that reads every OTHER command's
// shape. With this conversion `summarizeCommand` only ever sees `{ group }`
// and `{ command }`, so its legacy branch could go with the adapter.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import {
  RUNTIME_ADMIN_COMMANDS,
  buildCategorizedHelp,
  paginateHelp,
  summarizeCommand,
} from '../../../core/help.js';
import { hasPermission } from '../../../core/prefix/permissions.js';

export default {
  command: {
    name: 'help',
    description: 'Show the commands YOU can use, sorted by category.',
    emoji: '📻',
    args: [],
    async run(ctx) {
      const prefix = ctx.prefix;
      const commands = (ctx.client.moduleList ?? []).flatMap((mod) =>
        mod.commands.map(summarizeCommand),
      );

      // Only show what this viewer can actually run (S43): commands declaring
      // permissions the member lacks are hidden, as are the runtime-gated
      // admin commands (!update, !restart), whose gate is inside run().
      const isAdmin = hasPermission(ctx, PermissionFlagsBits.ManageGuild);
      const isVisible = (cmd) => {
        if (RUNTIME_ADMIN_COMMANDS.has(cmd.name)) return isAdmin;
        if (!cmd.defaultMemberPermissions) return true;
        try {
          return hasPermission(ctx, BigInt(cmd.defaultMemberPermissions));
        } catch {
          return true; // an unparsable bitfield must never hide the whole menu
        }
      };

      // Paged (S39): the roster exceeds one embed's 6000-character total.
      // Every page is an in-channel no-ping reply — S54 removed DMs, S68
      // removed the ephemeral form these used to take.
      const pages = paginateHelp(buildCategorizedHelp(commands, prefix, { isVisible }));
      for (const page of pages) {
        const embed = new EmbedBuilder()
          .setColor(0x8a5a6a)
          .setTitle(page.title)
          .addFields(page.fields);
        if (page.description) embed.setDescription(page.description);
        await ctx.reply({ embeds: [embed] });
      }
    },
  },
};
