import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import {
  clearRoleInfo,
  detectSelfRoles,
  getSelfrolesConfig,
  getSelfrolesInfo,
  refreshSelfRoles,
  setRoleInfo,
  setSelfrolesConfig,
} from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('selfroles')
    .setDescription('The self-roles list: post/refresh it, or set per-role info (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Self-roles on/off'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel where the list lives')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addBooleanOption((o) =>
      o.setName('post').setDescription('Post the list now (or refresh the existing one)'),
    )
    .addRoleOption((o) => o.setName('role').setDescription('Role to set info for (with info/emoji/clear-info)'))
    .addStringOption((o) => o.setName('emoji').setDescription('Emoji shown on that role’s line and button'))
    .addBooleanOption((o) => o.setName('clear-info').setDescription('Remove the stored info for that role'))
    .addStringOption((o) =>
      o.setName('info').setDescription('Info text shown next to that role in the list'),
    ),
  // `!selfroles @role … the whole rest is the info text`
  textGreedyArg: 'info',
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const guild = interaction.guild;
    const notes = [];

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    if (enabled !== null) patch.enabled = enabled;
    if (channel) patch.channelId = channel.id;
    if (Object.keys(patch).length) setSelfrolesConfig(guild.id, patch);

    const role = interaction.options.getRole('role');
    const info = interaction.options.getString('info');
    const emoji = interaction.options.getString('emoji');
    if (role) {
      if (interaction.options.getBoolean('clear-info') === true) {
        notes.push(
          clearRoleInfo(guild.id, role.id)
            ? `🗑️ Info for **${role.name}** cleared.`
            : `ℹ️ **${role.name}** had no stored info.`,
        );
      } else if (info !== null || emoji !== null) {
        setRoleInfo(guild.id, role.id, {
          ...(info !== null ? { text: info } : {}),
          ...(emoji !== null ? { emoji } : {}),
        });
        notes.push(`📝 Info for **${role.name}** saved.`);
      } else {
        notes.push('ℹ️ Give `info:` and/or `emoji:` with that role (or `clear-info:True`).');
      }
    } else if (info !== null || emoji !== null) {
      notes.push('⚠️ `info:`/`emoji:` need a `role:` to attach to.');
    }

    let refreshed = null;
    if (interaction.options.getBoolean('post') === true || (role && notes.at(-1)?.startsWith('📝')) || (role && notes.at(-1)?.startsWith('🗑️'))) {
      refreshed = await refreshSelfRoles(guild);
      const outcomes = {
        posted: '✅ List posted.',
        edited: '✅ List refreshed.',
        'no-header': '⚠️ No role named **self-roles** found in the role list — add that header role with the self-assignable roles below it.',
        'missing-channel': '⚠️ I can’t post in the configured channel — pick another with `channel:`.',
        disabled: 'ℹ️ Self-roles are disabled — enable with `enabled:True`.',
        unconfigured: '⚠️ No channel configured — set one with `channel:`.',
      };
      notes.push(outcomes[refreshed] ?? `ℹ️ Refresh result: ${refreshed}`);
    }

    const config = getSelfrolesConfig(guild.id);
    const detection = detectSelfRoles(guild);
    const storedInfo = getSelfrolesInfo(guild.id);
    const roleLines = detection.roles.map((r) => {
      const extra = storedInfo[r.id] ?? {};
      const marks = [extra.emoji, extra.text ? '📝' : null].filter(Boolean).join(' ');
      return `• **${r.name}**${marks ? ` ${marks}` : ''}`;
    });
    const skippedLines = detection.skipped.map((r) => `• ~~${r.name}~~ — ${r.reason}`);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎭 Self Roles — setup')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set'}`,
          `**Header:** a role named \`${config.headerName}\` ${detection.headerFound ? '(found ✅)' : '(**not found** ⚠️ — create it and put the self-assignable roles directly below it)'}`,
          '',
          `**Self-assignable (${detection.roles.length}):**`,
          roleLines.length ? roleLines.join('\n') : '_none detected_',
          ...(skippedLines.length ? ['', '**Skipped:**', ...skippedLines] : []),
          ...(notes.length ? ['', ...notes] : []),
          '',
          '_Members use the buttons under the posted list — never this command._',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } });
  },
};
