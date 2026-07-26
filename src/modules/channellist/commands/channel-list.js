// The channel-directory group (S70 = M17.2): the old !channellist actions and
// !channellist options merged into ONE Red-style group (the retired
// config name stays as an alias). Bare `!channellist` shows the settings.
import { PermissionFlagsBits } from 'discord.js';
import {
  DEFAULT_HEADER,
  MAX_HEADER_LENGTH,
  normalizeEmojiInput,
  parseHexColor,
} from '../lib/list.js';
import {
  getChannellistConfig,
  refreshList,
  removeList,
  scheduleAutoUpdate,
  setChannellistConfig,
  withListLock,
} from '../service.js';

const RESULTS = {
  unchanged: '📋 The channel list is already up to date.',
  edited: '📋 Channel list updated — the existing messages were edited in place.',
  posted: '📋 Channel list posted.',
  reposted: '📋 Channel list reposted.',
  unconfigured: '⚠️ No list channel set yet — run `!channellist post #channel` once.',
  'missing-channel':
    '⚠️ The configured channel no longer exists — pick a new one with `!channellist post #channel`.',
  forbidden: '⚠️ I need permission to view and send messages in the configured channel.',
};

// Config patch + auto-refresh of the posted list, one short confirmation.
async function patchAndRefresh(ctx, patch, note) {
  setChannellistConfig(ctx.guild.id, patch);
  scheduleAutoUpdate(ctx.guild);
  await ctx.reply(note);
}

export default {
  group: {
    name: 'channellist',
    aliases: ['channel-list', 'channel-list-config', 'channels'],
    description: 'The channel directory: post/update/remove it and tune its look (admin).',
    emoji: '🗂️',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getChannellistConfig(ctx.guild.id);
      const roleDisplay = config.roleId
        ? ctx.guild.roles.cache.get(config.roleId)?.name ?? `deleted role (${config.roleId}) → @everyone`
        : '@everyone';
      const ignoredDisplay = (config.ignoredIds ?? []).map((id) => {
        const target = ctx.guild.channels.cache.get(id);
        return target ? `<#${id}>` : `deleted (${id})`;
      });
      return [
        `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set'}`,
        `**Visibility role:** ${roleDisplay}`,
        `**Auto update:** ${config.autoUpdate ? 'on (refreshes ~10 s after channel changes)' : 'off'}`,
        `**Voice channels:** ${config.includeVoice ? 'included' : 'hidden'}`,
        `**Category emoji:** ${config.emoji || 'none'}`,
        `**Embed color:** #${Number(config.embedColor).toString(16).padStart(6, '0')}`,
        `**Posted embeds:** ${config.messageIds?.length ?? 0}`,
        `**Header:** ${config.header?.slice(0, 500) || 'none'}`,
        ...(ignoredDisplay.length ? [`**Ignored:** ${ignoredDisplay.join(', ').slice(0, 800)}`] : []),
      ];
    },
    subcommands: [
      {
        name: 'post',
        description: '(Re)post the full list — optionally into a new channel.',
        args: [{ name: 'channel', type: 'channel', required: false, postable: true }],
        async run(ctx, { channel }) {
          await ctx.channel.sendTyping?.().catch(() => {});
          if (channel) setChannellistConfig(ctx.guild.id, { channelId: channel.id });
          const result = await withListLock(ctx.guild.id, () =>
            refreshList(ctx.guild, { forceRepost: true }),
          );
          await ctx.reply(RESULTS[result] ?? result);
        },
      },
      {
        name: 'update',
        description: 'Refresh the posted list, editing in place when possible.',
        args: [],
        async run(ctx) {
          await ctx.channel.sendTyping?.().catch(() => {});
          const result = await withListLock(ctx.guild.id, () => refreshList(ctx.guild));
          await ctx.reply(RESULTS[result] ?? result);
        },
      },
      {
        name: 'remove',
        description: 'Delete the posted list.',
        args: [],
        async run(ctx) {
          const removed = await removeList(ctx.guild);
          await ctx.reply(removed ? '🗑️ Channel list removed.' : 'ℹ️ There is no posted channel list to remove.');
        },
      },
      {
        name: 'role',
        description: 'Only channels THIS role can see are listed.',
        args: [{ name: 'role', type: 'role', required: true }],
        async run(ctx, { role }) {
          await patchAndRefresh(ctx, { roleId: role.id }, `✅ The list shows what **${role.name}** can see.`);
        },
      },
      {
        name: 'everyone',
        description: 'Reset visibility to what @everyone can see.',
        args: [],
        async run(ctx) {
          await patchAndRefresh(ctx, { roleId: null }, '✅ The list shows what @everyone can see.');
        },
      },
      {
        name: 'header',
        description: 'Intro text above the list — pass "default" to restore the default.',
        args: [{ name: 'text', type: 'string', required: true, greedy: true }],
        async run(ctx, { text }) {
          const header =
            text.trim().toLowerCase() === 'default' ? DEFAULT_HEADER : text.slice(0, MAX_HEADER_LENGTH);
          await patchAndRefresh(ctx, { header }, '✅ Header saved.');
        },
      },
      {
        name: 'emoji',
        description: 'Emoji decorating category headers — "none" removes it.',
        args: [{ name: 'emoji', type: 'string', required: true }],
        async run(ctx, { emoji }) {
          await patchAndRefresh(ctx, { emoji: normalizeEmojiInput(emoji) }, '✅ Category emoji saved.');
        },
      },
      {
        name: 'color',
        description: 'Embed color as hex (e.g. #5865f2) — "default" restores.',
        args: [{ name: 'color', type: 'string', required: true }],
        async run(ctx, { color }) {
          if (color.trim().toLowerCase() === 'default') {
            await patchAndRefresh(ctx, { embedColor: 0x5865f2 }, '✅ Embed color restored to the default.');
            return;
          }
          const parsed = parseHexColor(color);
          if (parsed === null) {
            await ctx.reply('🚫 Use a hex value like `#5865f2`, or `default`.');
            return;
          }
          await patchAndRefresh(ctx, { embedColor: parsed }, `✅ Embed color set to #${parsed.toString(16).padStart(6, '0')}.`);
        },
      },
      {
        name: 'voice',
        description: 'Include (or hide) voice and stage channels.',
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          await patchAndRefresh(ctx, { includeVoice: state }, state ? '✅ Voice channels are **included**.' : '✅ Voice channels are **hidden**.');
        },
      },
      {
        name: 'autoupdate',
        aliases: ['auto-update'],
        description: 'Refresh automatically when channels change.',
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          await patchAndRefresh(ctx, { autoUpdate: state }, state ? '✅ Auto update is **on**.' : '✅ Auto update is **off**.');
        },
      },
      {
        name: 'ignore',
        description: 'Hide a channel or category from the list.',
        args: [{ name: 'channel', type: 'channel', required: true }],
        async run(ctx, { channel }) {
          const current = getChannellistConfig(ctx.guild.id);
          const ignored = new Set((current.ignoredIds ?? []).map(String));
          ignored.add(String(channel.id));
          await patchAndRefresh(ctx, { ignoredIds: [...ignored] }, `✅ <#${channel.id}> is hidden from the list.`);
        },
      },
      {
        name: 'unignore',
        description: 'Show a channel again — accepts a #mention or a raw id (for deleted channels).',
        args: [{ name: 'channel', type: 'string', required: true }],
        async run(ctx, { channel }) {
          // String on purpose: a DELETED channel can only be named by raw id,
          // which the channel arg type would refuse to resolve.
          const id = channel.match(/^<#(\d+)>$/)?.[1] ?? channel.match(/^(\d{15,21})$/)?.[1];
          if (!id) {
            await ctx.reply('🚫 Give a #channel mention or a raw channel id.');
            return;
          }
          const current = getChannellistConfig(ctx.guild.id);
          const ignored = new Set((current.ignoredIds ?? []).map(String));
          if (!ignored.delete(id)) {
            await ctx.reply('ℹ️ That channel was not ignored.');
            return;
          }
          await patchAndRefresh(ctx, { ignoredIds: [...ignored] }, `✅ \`${id}\` is back on the list.`);
        },
      },
    ],
  },
};
