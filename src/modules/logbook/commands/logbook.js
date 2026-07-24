import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { CATEGORIES } from '../lib/logformat.js';
import { getLogbookConfig, setLogbookConfig } from '../service.js';

const CATEGORY_HELP = {
  messages: 'deleted/edited/purged messages',
  members: 'joins, leaves, nickname & role changes',
  moderation: 'bans and unbans',
  voice: 'voice joins/leaves/moves',
  server: 'channels, roles, emojis',
  invites: 'invite creates/deletes',
};

function buildData() {
  const builder = new SlashCommandBuilder()
    .setName('logbook')
    .setDescription('View or change the station logbook — logs server events to a channel (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Master switch for all logging'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel that receives the log entries')
        .addChannelTypes(ChannelType.GuildText),
    );
  for (const category of CATEGORIES) {
    builder.addBooleanOption((o) => o.setName(category).setDescription(`Log ${CATEGORY_HELP[category]}`));
  }
  return builder;
}

export default {
  data: buildData(),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    if (enabled !== null) patch.enabled = enabled;
    if (channel) patch.channelId = channel.id;
    for (const category of CATEGORIES) {
      const value = interaction.options.getBoolean(category);
      if (value !== null) patch[category] = value;
    }
    const config = Object.keys(patch).length
      ? setLogbookConfig(interaction.guild.id, patch)
      : getLogbookConfig(interaction.guild.id);

    const categoryLines = CATEGORIES.map(
      (c) => `${config[c] ? '✅' : '❌'} **${c}** — ${CATEGORY_HELP[c]}`,
    );
    // Member events silently need the privileged intent — say so right here.
    const intentLine = interaction.client.memberEventsAvailable
      ? '✅ Server Members Intent active (joins/leaves/role changes visible).'
      : '⚠️ **Server Members Intent OFF** — joins, leaves and role changes are INVISIBLE to me. Enable it: Developer Portal → Bot → Privileged Gateway Intents, then `/restart`.';

    const embed = new EmbedBuilder()
      .setColor(0x34495e)
      .setTitle('📔 Station Logbook')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set — nothing is logged until an admin picks one'}`,
          '',
          ...categoryLines,
          '',
          intentLine,
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
