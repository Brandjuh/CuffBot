import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { CROOKS } from '../lib/hunt.js';
import { getScores } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('hunt-stats')
    .setDescription('A hunter’s arrest record: catches per crook type.')
    .addUserOption((o) => o.setName('member').setDescription('Whose record (default: you)')),
  async execute(interaction) {
    const target = interaction.options.getUser('member') ?? interaction.user;
    const record = getScores(interaction.guild.id)[target.id];
    if (!record?.total) {
      await interaction.reply({
        content: '🦹 Cuff a crook before you brag about it — shout **STOP POLICE** when one appears.',
        flags: 64,
      });
      return;
    }
    const lines = CROOKS.filter((c) => record.byCrook?.[c.id]).map(
      (c) => `${c.emoji} ${c.id.replace(/-/g, ' ')} — **${record.byCrook[c.id]}**`,
    );
    const embed = new EmbedBuilder()
      .setColor(0x1f8b4c)
      .setTitle(`🚔 Arrest record — ${target.username}`)
      .setDescription([`**${record.total}** crook${record.total === 1 ? '' : 's'} cuffed in total`, '', ...lines].join('\n'));
    await interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
