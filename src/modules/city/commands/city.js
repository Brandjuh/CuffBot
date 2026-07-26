// `!city` — the hub (S133), and the restoration of a command that spent eleven
// sessions answering with silence.
//
// S122 removed `city` as an alias of `crime` and wrote that it "leaves `city`
// free for the hub when it exists". Nothing built the hub; M26.3 was closed as
// COMPLETE two sessions later. Because the router drops an unknown command
// without a word, `!city` did not degrade to the crime panel or print a hint —
// it did nothing at all, which is what the owner reported.
//
// Flat, not a group: the hub has no subcommands. Everything it leads to is a
// button, which is the point.
import { EmbedBuilder } from 'discord.js';
import { cityHub } from '../lib/hub.js';
import { buttonRow } from './crime.js';
import { cityBalance, getCriminal, jailState } from '../service.js';

/** The hub as a Discord payload. Exported so the pump can re-render it. */
export async function hubPayload(guild, user) {
  const criminal = getCriminal(guild.id, user.id);
  const view = cityHub({
    criminal,
    balance: await cityBalance(guild.id, user.id),
    jail: jailState(criminal),
  });

  return {
    embeds: [
      new EmbedBuilder().setColor(0x34495e).setTitle(view.title).setDescription(view.lines.join('\n')),
    ],
    components: [buttonRow(user.id, view.buttons)],
    allowedMentions: { parse: [] },
  };
}

export default {
  command: {
    name: 'city',
    description: 'The city hub — the jobs board, the black market, the leaderboard and your record.',
    emoji: '🌆',
    args: [],
    async run(ctx) {
      await ctx.reply(await hubPayload(ctx.guild, ctx.user));
    },
  },
};
