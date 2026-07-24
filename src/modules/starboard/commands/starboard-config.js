import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { getBoardedData, getStarboardConfig, setStarboardConfig } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('starboard-config')
    .setDescription('View or change the commendation board (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the starboard on/off'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel where starred messages are reposted')
        .addChannelTypes(ChannelType.GuildText),
    )
    .addIntegerOption((o) =>
      o.setName('threshold').setDescription('Stars needed to board a message (1–25)').setMinValue(1).setMaxValue(25),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    const threshold = interaction.options.getInteger('threshold');
    if (enabled !== null) patch.enabled = enabled;
    if (channel) patch.channelId = channel.id;
    if (threshold !== null) patch.threshold = threshold;
    const config = Object.keys(patch).length
      ? setStarboardConfig(interaction.guild.id, patch)
      : getStarboardConfig(interaction.guild.id);

    const boardedCount = (getBoardedData(interaction.guild.id).order ?? []).length;
    const embed = new EmbedBuilder()
      .setColor(0xf5b041)
      .setTitle('⭐ Commendation Board')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set — nothing is boarded until an admin picks one'}`,
          `**Threshold:** ${config.threshold} × ${config.emoji}`,
          `**Boarded so far:** ${boardedCount}`,
          '',
          `React with ${config.emoji} on any message; at ${config.threshold} stars it earns a spot on the board. Each message boards once.`,
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
