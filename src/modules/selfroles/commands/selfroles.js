// The self-roles admin group (S70 = M17.2): `!selfroles <sub>` manages the
// button list; bare `!selfroles` shows the detection + config status. Members
// never use this — they press the buttons under the posted list.
import { PermissionFlagsBits } from 'discord.js';
import {
  clearRoleInfo,
  detectSelfRoles,
  getSelfrolesConfig,
  getSelfrolesInfo,
  refreshSelfRoles,
  setRoleInfo,
  setSelfrolesConfig,
} from '../service.js';

const REFRESH_OUTCOMES = {
  posted: '✅ List posted.',
  edited: '✅ List refreshed.',
  'no-header':
    '⚠️ No role named **self-roles** found in the role list — add that header role with the self-assignable roles below it.',
  'missing-channel': '⚠️ I can’t post in the configured channel — pick another with `channel`.',
  disabled: 'ℹ️ Self-roles are disabled — enable with `on`.',
  unconfigured: '⚠️ No channel configured — set one with `channel`.',
};

const refreshNote = (result) => REFRESH_OUTCOMES[result] ?? `ℹ️ Refresh result: ${result}`;

export default {
  group: {
    name: 'selfroles',
    description: 'The self-roles button list: post/refresh it, set per-role info (admin).',
    emoji: '🎭',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getSelfrolesConfig(ctx.guild.id);
      const detection = detectSelfRoles(ctx.guild);
      const storedInfo = getSelfrolesInfo(ctx.guild.id);
      const roleLines = detection.roles.map((r) => {
        const extra = storedInfo[r.id] ?? {};
        const marks = [extra.emoji, extra.text ? '📝' : null].filter(Boolean).join(' ');
        return `• **${r.name}**${marks ? ` ${marks}` : ''}`;
      });
      const skippedLines = detection.skipped.map((r) => `• ~~${r.name}~~ — ${r.reason}`);
      return [
        `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
        `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set'}`,
        `**Header:** a role named \`${config.headerName}\` ${detection.headerFound ? '(found ✅)' : '(**not found** ⚠️ — create it and put the self-assignable roles directly below it)'}`,
        '',
        `**Self-assignable (${detection.roles.length}):**`,
        roleLines.length ? roleLines.join('\n') : '_none detected_',
        ...(skippedLines.length ? ['', '**Skipped:**', ...skippedLines] : []),
        '',
        '_Members use the buttons under the posted list — never this command._',
      ];
    },
    subcommands: [
      {
        name: 'on',
        description: 'Turn self-roles on.',
        args: [],
        async run(ctx) {
          setSelfrolesConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ Self-roles are **on**.');
        },
      },
      {
        name: 'off',
        description: 'Turn self-roles off.',
        args: [],
        async run(ctx) {
          setSelfrolesConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 Self-roles are **off**.');
        },
      },
      {
        name: 'channel',
        description: 'Set the channel where the button list lives.',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setSelfrolesConfig(ctx.guild.id, { channelId: channel.id });
          await ctx.reply(`✅ The self-roles list lives in <#${channel.id}> — post it with \`${ctx.prefix}selfroles post\`.`);
        },
      },
      {
        name: 'post',
        aliases: ['refresh'],
        description: 'Post the list now (or refresh the existing one).',
        args: [],
        async run(ctx) {
          await ctx.reply(refreshNote(await refreshSelfRoles(ctx.guild)));
        },
      },
      {
        name: 'info',
        description: 'Set the info text shown next to a role in the list.',
        args: [
          { name: 'role', type: 'role', required: true },
          { name: 'text', type: 'string', required: true, greedy: true },
        ],
        async run(ctx, { role, text }) {
          setRoleInfo(ctx.guild.id, role.id, { text });
          const refreshed = await refreshSelfRoles(ctx.guild);
          await ctx.reply(`📝 Info for **${role.name}** saved. ${refreshNote(refreshed)}`);
        },
      },
      {
        name: 'emoji',
        description: 'Set the emoji shown on a role’s line and button.',
        args: [
          { name: 'role', type: 'role', required: true },
          { name: 'emoji', type: 'string', required: true },
        ],
        async run(ctx, { role, emoji }) {
          setRoleInfo(ctx.guild.id, role.id, { emoji });
          const refreshed = await refreshSelfRoles(ctx.guild);
          await ctx.reply(`📝 Emoji for **${role.name}** saved. ${refreshNote(refreshed)}`);
        },
      },
      {
        name: 'clearinfo',
        aliases: ['clear-info'],
        description: 'Remove the stored info/emoji for a role.',
        args: [{ name: 'role', type: 'role', required: true }],
        async run(ctx, { role }) {
          const cleared = clearRoleInfo(ctx.guild.id, role.id);
          if (!cleared) {
            await ctx.reply(`ℹ️ **${role.name}** had no stored info.`);
            return;
          }
          const refreshed = await refreshSelfRoles(ctx.guild);
          await ctx.reply(`🗑️ Info for **${role.name}** cleared. ${refreshNote(refreshed)}`);
        },
      },
    ],
  },
};
