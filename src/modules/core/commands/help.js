// S98 (M19, owner request: "Help menu: Buttons per categorie"): `!help` posts
// ONE message with a button per category instead of the sequential embed pages
// S39/S43 produced. Pressing a button swaps the embed.
//
// S96 converted this to the flat { command } shape — it is the command that
// reads every OTHER command's shape, so its conversion is what let
// `summarizeCommand` drop its legacy branch.
import { buildViewerHelp, helpPayload } from '../lib/help-menu.js';
import { helpOverview } from '../../../core/help.js';

export default {
  command: {
    name: 'help',
    description: 'Show the commands YOU can use, sorted by category.',
    emoji: '📻',
    args: [],
    async run(ctx) {
      // Filtered for THIS viewer (S43): the buttons only offer categories the
      // member has something in, so the menu never advertises a dead end.
      const model = buildViewerHelp(ctx, ctx.prefix, ctx.client.moduleList ?? []);
      await ctx.reply(helpPayload(helpOverview(model), ctx.user.id));
    },
  },
};
