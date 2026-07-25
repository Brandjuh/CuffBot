// S94 (M17.3 slice B): converted to the flat { command } shape.
import { EmbedBuilder } from 'discord.js';
import { resolveLadder } from '../service.js';

export default {
  command: {
    name: 'ranks',
    description: 'Show the precinct rank ladder detected from the server roles.',
    emoji: '🎖️',
    args: [],
    async run(ctx) {
      const ladder = resolveLadder(ctx);
      const embed = new EmbedBuilder().setColor(0xd4a24e).setTitle('🎖️ Precinct Rank Ladder');

      if (!ladder.headerFound || ladder.ranks.length === 0) {
        embed.setDescription(
          'No rank ladder detected yet.\nAn admin can point me at the header role with `!rank-setup header:@[LEVELER]` ' +
            '(the divider your rank roles sit under), then run `!ranks` again.',
        );
        await ctx.reply({ embeds: [embed] });
        return;
      }

      // ranks are highest-first already.
      const lines = ladder.ranks.map((r, i) => `**${i + 1}.** <@&${r.roleId}>`);
      embed.setDescription(lines.join('\n')).setFooter({
        text: `${ladder.ranks.length} ranks · highest first · ${ctx.prefix}promote and ${ctx.prefix}demote walk this ladder`,
      });
      await ctx.reply({ embeds: [embed] });
    },
  },
};
