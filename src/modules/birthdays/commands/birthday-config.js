import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { getBirthdayConfig, setBirthdayConfig } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('birthday-config')
    .setDescription('View or change birthday announcements (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn birthday announcements on/off'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel where birthdays are announced')
        .addChannelTypes(ChannelType.GuildText),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    if (enabled !== null) patch.enabled = enabled;
    if (channel) patch.channelId = channel.id;
    const config = Object.keys(patch).length
      ? setBirthdayConfig(interaction.guild.id, patch)
      : getBirthdayConfig(interaction.guild.id);

    const embed = new EmbedBuilder()
      .setColor(0xdb6ea4)
      .setTitle('🎂 Birthday Announcements')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set — nothing is announced until an admin picks one'}`,
          '',
          'Members register with `/birthday-set` (own timezone supported); the sweep checks every ~10 minutes, announces on the member’s own calendar day, once per year.',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
