// S98 (M19, owner request: "Help menu: Buttons per categorie"): `!help` posts
// ONE message with a button per category instead of the sequential embed pages
// S39/S43 produced. Pressing a button swaps the embed.
//
// S96 converted this to the flat { command } shape — it is the command that
// reads every OTHER command's shape, so its conversion is what let
// `summarizeCommand` drop its legacy branch.
import { buildViewerHelp, helpPayload } from '../lib/help-menu.js';
import { helpOverview } from '../../../core/help.js';
import { publishHelpPanel, removeHelpPanel } from '../service-helppanel.js';

import { PermissionFlagsBits } from 'discord.js';

export default {
  group: {
    name: 'help',
    aliases: ['commands', 'roster'],
    description: 'Show the commands YOU can use, sorted by category.',
    emoji: '📻',
    fallback: 'me',
    // Bare `!help` still opens the menu — folding the panel in must not change
    // the one command everybody types (Red's `invoke_without_command`).
    invokeWithoutSubcommand: true,
    subcommands: [
      {
        name: 'me',
        aliases: ['menu', 'show'],
        description: 'The category menu, filtered to what you can use.',
        args: [],
        async run(ctx) {
          // Filtered for THIS viewer (S43): the buttons only offer categories
          // the member has something in, so the menu never advertises a dead end.
          const model = buildViewerHelp(ctx, ctx.prefix, ctx.client.moduleList ?? []);
          await ctx.reply(helpPayload(helpOverview(model), ctx.user.id));
        },
      },
      {
        name: 'panel',
        aliases: ['post', 'pin'],
        description: 'Put a permanent category panel in a channel (or refresh it).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'channel', type: 'channel', postable: true }], // default: here
        async run(ctx, { channel }) {
          const target = channel ?? ctx.channel;
          await ctx.typing();
          const result = await publishHelpPanel(ctx.guild, target, ctx.prefix);
          const said = {
            posted: `📻 Panel posted in ${target}. Anyone can press it, and every answer is private.`,
            edited: `📻 Panel refreshed in ${target}.`,
            moved: `📻 Panel moved to ${target}; the old one is gone.`,
            failed: `🚫 I could not post in ${target} — check my permissions there.`,
          };
          await ctx.reply({ content: said[result], allowedMentions: { parse: [] } });
        },
      },
      {
        name: 'unpanel',
        aliases: ['unpost', 'remove'],
        description: 'Take the permanent panel down.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          const result = await removeHelpPanel(ctx.guild);
          await ctx.reply(
            {
              removed: '📻 Panel removed.',
              forgotten: '📻 The panel message was already gone — I have forgotten it.',
              none: '📻 There is no panel to remove.',
            }[result],
          );
        },
      },
    ],
  },
};
