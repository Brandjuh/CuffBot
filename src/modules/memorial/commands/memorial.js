// The memorial admin group (S70 = M17.2, was !memorial-config — kept as an
// alias): per-feed channels/roles, live preview, and the S61 probe for
// candidate feed URLs (the bot host has open internet; sessions do not).
import { PermissionFlagsBits } from 'discord.js';
import { itemMatchesFeed } from '../lib/rss.js';
import {
  FEEDS,
  channelIdForFeed,
  fetchFeedItems,
  getMemorialConfig,
  getSeen,
  probeFeed,
  roleIdForFeed,
  setMemorialConfig,
} from '../service.js';

// One status line per feed; `preview` adds the live latest-entry line.
async function feedLines(ctx, config, { preview = false } = {}) {
  const seen = getSeen(ctx.guild.id);
  const lines = [];
  for (const feed of FEEDS) {
    const baselined = Array.isArray(seen[feed.id]) ? `${seen[feed.id].length} seen` : 'not baselined yet';
    let latest = '';
    if (preview) {
      const items = await fetchFeedItems(feed);
      if (items === null) {
        latest = '\n   latest: _feed unreachable right now_';
      } else {
        const matching = items.filter((i) => itemMatchesFeed(feed.match, i));
        const filterNote = feed.match ? ` (${matching.length} of ${items.length} pass the memorial filter)` : '';
        latest = matching.length
          ? `\n   latest: [${matching[0].title}](${matching[0].link ?? feed.url})${filterNote}`
          : `\n   latest: _no matching entries in the feed right now_${filterNote}`;
      }
    }
    const target = channelIdForFeed(config, feed.id);
    const where = target
      ? `<#${target}>${config[`${feed.id}ChannelId`] ? '' : ' (shared)'}`
      : '⚠️ no channel';
    // S62: a deleted role renders as @unknown-role — say so out loud, with
    // the exact subcommand that fixes it.
    const pingRoleId = roleIdForFeed(config, feed);
    const roleLabel = !pingRoleId
      ? 'no ping'
      : ctx.guild.roles.cache.has(pingRoleId)
        ? `<@&${pingRoleId}>`
        : `⚠️ role \`${pingRoleId}\` no longer exists — set a new one with \`${ctx.prefix}memorial ${feed.id === 'odmp' ? 'officers-role' : 'firefighters-role'}\``;
    lines.push(`${feed.emoji} **${feed.title}** → ${roleLabel} in ${where} (${baselined})${latest}`);
  }
  return lines;
}

const statusHead = (config) => [
  `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
  `**Shared fallback channel:** ${config.channelId ? `<#${config.channelId}>` : 'none — each feed needs its own channel below'}`,
  '',
];

const FOOTER =
  '_First sweep baselines each feed (no history flood); new entries post after that, sweeping every 30 minutes._';

export default {
  group: {
    name: 'memorial',
    aliases: ['memorial-config'],
    description: 'The fallen-heroes tracker: feeds, channels, ping roles (admin).',
    emoji: '🕯️',
    permission: PermissionFlagsBits.ManageGuild,
    async status(ctx) {
      const config = getMemorialConfig(ctx.guild.id);
      return [...statusHead(config), ...(await feedLines(ctx, config)), '', FOOTER];
    },
    subcommands: [
      {
        name: 'on',
        description: 'Turn the memorial tracker on.',
        args: [],
        async run(ctx) {
          setMemorialConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ The memorial tracker is **on**.');
        },
      },
      {
        name: 'off',
        description: 'Turn the memorial tracker off.',
        args: [],
        async run(ctx) {
          setMemorialConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 The memorial tracker is **off**.');
        },
      },
      {
        name: 'channel',
        description: 'Set the shared fallback channel (feeds without their own channel post here).',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setMemorialConfig(ctx.guild.id, { channelId: channel.id });
          await ctx.reply(`✅ Shared memorial channel set to <#${channel.id}>.`);
        },
      },
      {
        name: 'officers-channel',
        description: 'Own channel for Fallen Officers entries (wins over the shared channel).',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setMemorialConfig(ctx.guild.id, { odmpChannelId: channel.id });
          await ctx.reply(`✅ Fallen Officers entries post in <#${channel.id}>.`);
        },
      },
      {
        name: 'firefighters-channel',
        description: 'Own channel for Fallen Firefighters entries (wins over the shared channel).',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setMemorialConfig(ctx.guild.id, { fireheroChannelId: channel.id });
          await ctx.reply(`✅ Fallen Firefighters entries post in <#${channel.id}>.`);
        },
      },
      {
        name: 'officers-role',
        description: 'Role pinged for Fallen Officers entries.',
        args: [{ name: 'role', type: 'role', required: true }],
        async run(ctx, { role }) {
          setMemorialConfig(ctx.guild.id, { odmpRoleId: role.id });
          await ctx.reply(`✅ Fallen Officers entries ping <@&${role.id}>.`);
        },
      },
      {
        name: 'firefighters-role',
        description: 'Role pinged for Fallen Firefighters entries.',
        args: [{ name: 'role', type: 'role', required: true }],
        async run(ctx, { role }) {
          setMemorialConfig(ctx.guild.id, { fireheroRoleId: role.id });
          await ctx.reply(`✅ Fallen Firefighters entries ping <@&${role.id}>.`);
        },
      },
      {
        name: 'preview',
        description: 'Fetch each feed now and show its latest entry (nothing is posted).',
        args: [],
        async run(ctx) {
          await ctx.channel.sendTyping?.().catch(() => {});
          const config = getMemorialConfig(ctx.guild.id);
          const lines = await feedLines(ctx, config, { preview: true });
          await ctx.reply([...statusHead(config), ...lines, '', FOOTER].join('\n'));
        },
      },
      {
        name: 'probe',
        description: 'Try ANY feed URL live and show what it contains (posts nothing).',
        args: [{ name: 'url', type: 'string', required: true, greedy: true }],
        async run(ctx, { url }) {
          await ctx.channel.sendTyping?.().catch(() => {});
          const probe = await probeFeed(url);
          if (!probe.ok) {
            const reasons = {
              'bad-url': '⚠️ That is not an http(s) URL.',
              http: `⚠️ The feed answered HTTP ${probe.status}.`,
              unreachable: `⚠️ Unreachable: ${probe.message}`,
            };
            await ctx.reply([`**Probe** ${url}`, reasons[probe.code] ?? '⚠️ Probe failed.'].join('\n'));
            return;
          }
          await ctx.reply(
            [
              `**Probe** ${url}`,
              `${probe.total} item(s) parsed${probe.total ? ' — newest first:' : ' — empty or not RSS.'}`,
              ...probe.sample.map((s, i) => `${i + 1}. [${s.title}](${s.link ?? url})`),
            ].join('\n'),
          );
        },
      },
    ],
  },
};
