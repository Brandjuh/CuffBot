// The station-logbook admin group (S70 = M17.2): master switch, per-category
// toggles (`toggle`), and log routing (`route` / `channel`). Bare `!logbook`
// shows every category with its live destination.
import { PermissionFlagsBits } from 'discord.js';
import { CATEGORIES } from '../lib/logformat.js';
import { channelKey, getLogbookConfig, resolveLogChannelId, setLogbookConfig } from '../service.js';

const CATEGORY_HELP = {
  messages: 'deleted/edited/purged messages',
  members: 'joins, leaves, nickname & role changes',
  moderation: 'bans and unbans',
  voice: 'voice joins/leaves/moves',
  server: 'channels, roles, emojis',
  invites: 'invite creates/deletes',
};

export default {
  group: {
    name: 'logbook',
    description: 'The station logbook — logs server events to channels (admin).',
    emoji: '📔',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getLogbookConfig(ctx.guild.id);
      const categoryLines = CATEGORIES.map((c) => {
        const target = resolveLogChannelId(ctx.guild.id, c);
        return `${config[c] ? '✅' : '❌'} **${c}** → ${target ? `<#${target}>` : '⚠️ no channel'} — ${CATEGORY_HELP[c]}`;
      });
      // Member events silently need the privileged intent — say so right here.
      const intentLine = ctx.client.memberEventsAvailable
        ? '✅ Server Members Intent active (joins/leaves/role changes visible).'
        : '⚠️ **Server Members Intent OFF** — joins, leaves and role changes are INVISIBLE to me. Enable it: Developer Portal → Bot → Privileged Gateway Intents, then `!restart`.';
      return [
        `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
        '',
        ...categoryLines,
        '',
        intentLine,
      ];
    },
    subcommands: [
      {
        name: 'on',
        description: 'Turn all logging on (master switch).',
        args: [],
        async run(ctx) {
          setLogbookConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ The logbook is **open** — events are being logged.');
        },
      },
      {
        name: 'off',
        description: 'Turn all logging off (master switch).',
        args: [],
        async run(ctx) {
          setLogbookConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 The logbook is **closed** — nothing is logged.');
        },
      },
      {
        name: 'toggle',
        description: 'Turn one category of logs on or off.',
        args: [
          { name: 'category', type: 'string', required: true, choices: [...CATEGORIES] },
          { name: 'state', type: 'boolean', required: true },
        ],
        async run(ctx, { category, state }) {
          setLogbookConfig(ctx.guild.id, { [category]: state });
          await ctx.reply(
            state
              ? `✅ **${category}** logs are on (${CATEGORY_HELP[category]}).`
              : `❌ **${category}** logs are off.`,
          );
        },
      },
      {
        name: 'route',
        description: 'Send one category of logs to its own channel.',
        args: [
          { name: 'category', type: 'string', required: true, choices: [...CATEGORIES] },
          { name: 'channel', type: 'channel', required: true, postable: true },
        ],
        async run(ctx, { category, channel }) {
          setLogbookConfig(ctx.guild.id, { [channelKey(category)]: channel.id });
          await ctx.reply(`✅ **${category}** logs now go to <#${channel.id}>.`);
        },
      },
      {
        name: 'channel',
        description: 'Send EVERY category to one channel (overrides the per-category defaults).',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setLogbookConfig(ctx.guild.id, { channelId: channel.id });
          await ctx.reply(`✅ All logs now go to <#${channel.id}> (explicit \`route\` targets still win).`);
        },
      },
    ],
  },
};
