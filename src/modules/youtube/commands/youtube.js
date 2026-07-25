// The reference Red-style group command (S69 = M17.1): `!youtube <sub> …`
// replaces the old option-soup slash command. Bare `!youtube` shows the full
// status + subcommand overview; each subcommand does ONE thing and answers
// with a short confirmation — the Red-DiscordBot UX the owner asked for.
import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { resolveSendableChannel } from '../../../core/channels.js';
import { MAX_CREATORS } from '../lib/feed.js';
import {
  addCreator,
  getCreators,
  getYouTubeConfig,
  previewYouTube,
  removeCreator,
  setYouTubeConfig,
} from '../service.js';

const POSTABLE_TYPES = new Set([ChannelType.GuildText, ChannelType.GuildAnnouncement]);

export default {
  group: {
    name: 'youtube',
    description: 'Announce YouTube uploads: follow creators, pick the channel, ping a role (admin).',
    emoji: '📺',
    permission: PermissionFlagsBits.ManageGuild,
    async status(ctx) {
      const config = getYouTubeConfig(ctx.guild.id);
      const creators = getCreators(ctx.guild.id);
      // Live probe (S55): a configured channel the bot cannot actually post to
      // must show up HERE, not as a silent sweep no-op.
      let channelLine = '⚠️ not set — nothing posts until an admin picks one';
      if (config.channelId) {
        const target = await resolveSendableChannel(ctx.guild, config.channelId);
        channelLine = target
          ? `<#${config.channelId}>`
          : `⚠️ <#${config.channelId}> — I can't post there (deleted, wrong type, or hidden from me); pick another with \`${ctx.prefix}youtube channel\``;
      }
      const roster = Object.entries(creators)
        .map(([id, c]) => `📺 **${c.name}** — \`${id}\``)
        .join('\n');
      return [
        `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
        `**Channel:** ${channelLine}`,
        `**Pings:** ${config.pingRoleId ? `<@&${config.pingRoleId}> on every new upload` : 'nobody'}`,
        '**Checked:** every 10 minutes (plus right after a restart)',
        '',
        `**Following (${Object.keys(creators).length}/${MAX_CREATORS}):**`,
        roster || `_nobody yet — add one with \`${ctx.prefix}youtube add\`_`,
      ];
    },
    subcommands: [
      {
        name: 'on',
        description: 'Turn upload announcements on.',
        args: [],
        async run(ctx) {
          setYouTubeConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ Upload announcements are **on**.');
        },
      },
      {
        name: 'off',
        description: 'Turn upload announcements off.',
        args: [],
        async run(ctx) {
          setYouTubeConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 Upload announcements are **off**.');
        },
      },
      {
        name: 'channel',
        description: 'Set the channel where new uploads are posted.',
        args: [{ name: 'channel', type: 'channel', required: true }],
        async run(ctx, { channel }) {
          if (!POSTABLE_TYPES.has(channel.type)) {
            await ctx.reply('🚫 That has to be a text or announcement channel.');
            return;
          }
          setYouTubeConfig(ctx.guild.id, { channelId: channel.id });
          await ctx.reply(`✅ New uploads will be posted in <#${channel.id}>.`);
        },
      },
      {
        name: 'add',
        aliases: ['follow'],
        description: 'Follow a creator: channel ID (UC…), channel URL, or @handle.',
        args: [{ name: 'creator', type: 'string', required: true, greedy: true }],
        async run(ctx, { creator }) {
          // Feed fetches can take seconds — typing beats dead air (no defer on text).
          await ctx.channel.sendTyping?.().catch(() => {});
          const result = await addCreator(ctx.guild.id, creator);
          if (result.ok) {
            await ctx.reply(
              `✅ Now following **${result.name}**${result.latest ? ` (latest: *${result.latest}*)` : ''} — existing videos are NOT reposted; only new uploads from now on.`,
            );
            return;
          }
          const reasons = {
            'bad-input': '⚠️ Could not read that — paste a channel ID (`UC…`), a `youtube.com/channel/…` URL, or an `@handle`.',
            'fetch-failed': '⚠️ YouTube did not answer for that channel — check the ID/handle and try again.',
            exists: `ℹ️ Already following **${result.name ?? 'that creator'}**.`,
            full: `⚠️ Roster full (${MAX_CREATORS} creators max) — remove one first.`,
          };
          await ctx.reply(reasons[result.code] ?? '⚠️ Could not add that creator.');
        },
      },
      {
        name: 'remove',
        aliases: ['unfollow'],
        description: 'Unfollow a creator (name or channel ID).',
        args: [{ name: 'creator', type: 'string', required: true, greedy: true }],
        async run(ctx, { creator }) {
          const removed = removeCreator(ctx.guild.id, creator);
          await ctx.reply(
            removed ? `🗑️ Stopped following **${removed}**.` : 'ℹ️ No creator matched that name/ID.',
          );
        },
      },
      {
        name: 'preview',
        description: 'Show each creator’s latest video (fetches live, posts nothing).',
        args: [],
        async run(ctx) {
          await ctx.channel.sendTyping?.().catch(() => {});
          const lines = await previewYouTube(ctx.guild.id);
          await ctx.reply(lines.length ? lines.join('\n') : 'ℹ️ No creators on the roster yet.');
        },
      },
      {
        name: 'pingrole',
        description: 'Set the role pinged on every new upload.',
        args: [{ name: 'role', type: 'role', required: true }],
        async run(ctx, { role }) {
          setYouTubeConfig(ctx.guild.id, { pingRoleId: role.id });
          await ctx.reply(`✅ <@&${role.id}> will be pinged on every new upload.`);
        },
      },
      {
        name: 'noping',
        description: 'Stop pinging any role on uploads.',
        args: [],
        async run(ctx) {
          setYouTubeConfig(ctx.guild.id, { pingRoleId: null });
          await ctx.reply('🔕 Uploads will be announced without pinging anyone.');
        },
      },
    ],
  },
};
