// The newcomer-welcome admin group (S70 = M17.2, `!welcome` — the old
// `!welcome-config` name stays as an alias).
import { PermissionFlagsBits } from 'discord.js';
import { getWelcomeConfig, postWelcome, renderWelcome, setWelcomeConfig } from '../service.js';

export default {
  group: {
    name: 'welcome',
    aliases: ['welcome-config'],
    description: 'The newcomer welcome: channel and message (admin).',
    emoji: '👋',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getWelcomeConfig(ctx.guild.id);
      // The join event needs the privileged Server Members Intent — surface
      // its state here so a silent welcomer is explainable in one glance.
      const intentLine = ctx.client.memberEventsAvailable
        ? '✅ Server Members Intent is active — joins are detected.'
        : '⚠️ **Server Members Intent is OFF** — the bot cannot see joins! Enable it: Developer Portal → Bot → Privileged Gateway Intents → Server Members Intent, then `!restart`.';
      const preview = renderWelcome(config.message, {
        userMention: `<@${ctx.user.id}>`,
        serverName: ctx.guild.name,
      });
      return [
        `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
        `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set'}`,
        `**Preview:** ${preview.slice(0, 500)}`,
        '',
        intentLine,
      ];
    },
    subcommands: [
      {
        name: 'on',
        description: 'Turn welcome messages on.',
        args: [],
        async run(ctx) {
          setWelcomeConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ Newcomers are **welcomed**.');
        },
      },
      {
        name: 'off',
        description: 'Turn welcome messages off.',
        args: [],
        async run(ctx) {
          setWelcomeConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 Welcome messages are **off**.');
        },
      },
      {
        name: 'channel',
        description: 'Channel where newcomers are greeted.',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setWelcomeConfig(ctx.guild.id, { channelId: channel.id });
          await ctx.reply(`✅ Newcomers are greeted in <#${channel.id}>.`);
        },
      },
      {
        name: 'message',
        description: 'Custom welcome text — {user} = mention, {server} = server name.',
        args: [{ name: 'text', type: 'string', required: true, greedy: true }],
        async run(ctx, { text }) {
          setWelcomeConfig(ctx.guild.id, { message: text.slice(0, 1_500) });
          const config = getWelcomeConfig(ctx.guild.id);
          const preview = renderWelcome(config.message, {
            userMention: `<@${ctx.user.id}>`,
            serverName: ctx.guild.name,
          });
          await ctx.reply(`✅ Welcome message saved.\n**Preview:** ${preview.slice(0, 500)}`);
        },
      },
      {
        name: 'test',
        description: 'Post the welcome right now with YOU as the newcomer.',
        args: [],
        async run(ctx) {
          const config = getWelcomeConfig(ctx.guild.id);
          const sent = await postWelcome(ctx.guild, ctx.user.id, {
            displayName: ctx.member?.displayName,
          });
          await ctx.reply(
            sent
              ? `🧪 **Test:** welcome posted in <#${config.channelId}>.`
              : '⚠️ **Test failed:** check that the channel exists and CuffBot can send there.',
          );
        },
      },
    ],
  },
};
