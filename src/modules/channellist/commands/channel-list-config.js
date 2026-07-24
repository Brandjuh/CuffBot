import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import {
  DEFAULT_HEADER,
  MAX_HEADER_LENGTH,
  normalizeEmojiInput,
  parseHexColor,
} from '../lib/list.js';
import { getChannellistConfig, scheduleAutoUpdate, setChannellistConfig } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('channel-list-config')
    .setDescription('Configure the channel directory (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel the list is posted in (post it with /channel-list)')
        .addChannelTypes(ChannelType.GuildText),
    )
    .addRoleOption((o) =>
      o.setName('role').setDescription('Only channels THIS role can see are listed'),
    )
    .addBooleanOption((o) =>
      o.setName('everyone').setDescription('Reset visibility to what @everyone can see'),
    )
    .addStringOption((o) =>
      o
        .setName('header')
        .setDescription('Intro text above the list — pass "default" to restore the default'),
    )
    .addStringOption((o) =>
      o.setName('emoji').setDescription('Emoji decorating category headers — "none" removes it'),
    )
    .addStringOption((o) =>
      o.setName('color').setDescription('Embed color as hex (e.g. #5865f2) — "default" restores'),
    )
    .addBooleanOption((o) =>
      o.setName('include-voice').setDescription('Include voice and stage channels'),
    )
    .addBooleanOption((o) =>
      o.setName('auto-update').setDescription('Refresh automatically when channels change'),
    )
    .addChannelOption((o) =>
      o.setName('ignore').setDescription('Hide this channel or category from the list'),
    )
    .addChannelOption((o) =>
      o.setName('unignore').setDescription('Show this channel or category again'),
    )
    .addStringOption((o) =>
      o
        .setName('unignore-id')
        .setDescription('Unignore by raw id (cleans up entries for deleted channels)'),
    ),
  // Free-text option for "!channel-list-config" custom headers.
  textGreedyArg: 'header',
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const guildId = interaction.guild.id;
    const notes = [];
    const patch = {};

    const channel = interaction.options.getChannel('channel');
    if (channel) patch.channelId = channel.id;
    const role = interaction.options.getRole('role');
    if (role) patch.roleId = role.id;
    if (interaction.options.getBoolean('everyone') === true) patch.roleId = null;

    const header = interaction.options.getString('header');
    if (header !== null && header !== undefined) {
      patch.header = header.trim().toLowerCase() === 'default' ? DEFAULT_HEADER : header.slice(0, MAX_HEADER_LENGTH);
    }
    const emoji = interaction.options.getString('emoji');
    if (emoji !== null && emoji !== undefined) patch.emoji = normalizeEmojiInput(emoji);

    const colorInput = interaction.options.getString('color');
    if (colorInput !== null && colorInput !== undefined) {
      if (colorInput.trim().toLowerCase() === 'default') {
        patch.embedColor = 0x5865f2;
      } else {
        const parsed = parseHexColor(colorInput);
        if (parsed === null) {
          notes.push('⚠️ Color ignored — use a hex value like `#5865f2`.');
        } else {
          patch.embedColor = parsed;
        }
      }
    }

    const includeVoice = interaction.options.getBoolean('include-voice');
    if (includeVoice !== null) patch.includeVoice = includeVoice;
    const autoUpdate = interaction.options.getBoolean('auto-update');
    if (autoUpdate !== null) patch.autoUpdate = autoUpdate;

    const current = getChannellistConfig(guildId);
    const ignore = interaction.options.getChannel('ignore');
    const unignore = interaction.options.getChannel('unignore');
    const unignoreId = interaction.options.getString('unignore-id');
    if (ignore || unignore || unignoreId) {
      const ignored = new Set((current.ignoredIds ?? []).map(String));
      if (ignore) ignored.add(String(ignore.id));
      if (unignore) ignored.delete(String(unignore.id));
      if (unignoreId) ignored.delete(unignoreId.trim());
      patch.ignoredIds = [...ignored];
    }

    const config = Object.keys(patch).length
      ? setChannellistConfig(guildId, patch)
      : current;
    if (Object.keys(patch).length) scheduleAutoUpdate(interaction.guild);

    const roleDisplay = config.roleId
      ? interaction.guild.roles.cache.get(config.roleId)?.name ?? `deleted role (${config.roleId}) → @everyone`
      : '@everyone';
    const ignoredDisplay = (config.ignoredIds ?? []).map((id) => {
      const target = interaction.guild.channels.cache.get(id);
      return target ? `<#${id}>` : `deleted (${id})`;
    });

    const embed = new EmbedBuilder()
      .setColor(config.embedColor)
      .setTitle('🗂️ Channel List — Settings')
      .setDescription(
        [
          `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set'}`,
          `**Visibility role:** ${roleDisplay}`,
          `**Auto update:** ${config.autoUpdate ? 'on (refreshes ~10 s after channel changes)' : 'off'}`,
          `**Voice channels:** ${config.includeVoice ? 'included' : 'hidden'}`,
          `**Category emoji:** ${config.emoji || 'none'}`,
          `**Embed color:** #${Number(config.embedColor).toString(16).padStart(6, '0')}`,
          `**Posted embeds:** ${config.messageIds?.length ?? 0}`,
          `**Header:** ${config.header?.slice(0, 500) || 'none'}`,
          ignoredDisplay.length ? `**Ignored:** ${ignoredDisplay.join(', ').slice(0, 800)}` : null,
          ...notes,
        ]
          .filter(Boolean)
          .join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } });
  },
};
