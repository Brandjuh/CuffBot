import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { resolveLadder } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ranks')
    .setDescription('Show the precinct rank ladder detected from the server roles.'),
  async execute(interaction) {
    const ladder = resolveLadder(interaction);
    const embed = new EmbedBuilder().setColor(0xd4a24e).setTitle('🎖️ Precinct Rank Ladder');

    if (!ladder.headerFound || ladder.ranks.length === 0) {
      embed.setDescription(
        'No rank ladder detected yet.\nAn admin can point me at the header role with `/rank-setup header:@[LEVELER]` ' +
          '(the divider your rank roles sit under), then run `/ranks` again.',
      );
      await interaction.reply({ embeds: [embed] });
      return;
    }

    // ranks are highest-first already.
    const lines = ladder.ranks.map((r, i) => `**${i + 1}.** <@&${r.roleId}>`);
    embed
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${ladder.ranks.length} ranks · highest first · /promote and /demote walk this ladder` });
    await interaction.reply({ embeds: [embed] });
  },
};
