// The chat-starter admin group (S70 = M17.2, `!chatstarter` — the old
// `!chatstarter` name stays as an alias).
import { PermissionFlagsBits } from 'discord.js';
import { getStarterConfig, nextQuestion, postStarter, questionBank, setStarterConfig } from '../service.js';
import { pickProvider } from '../../detective/lib/providers.js';

export const TEST_DELAY_MS = 30_000;

export default {
  group: {
    name: 'chatstarter',
    aliases: ['chat-starter', 'chat-starter-config', 'starter'],
    description: 'The chat starter: revives a quiet channel with an open question (admin).',
    emoji: '💬',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getStarterConfig(ctx.guild.id);
      const aiReady = Boolean(pickProvider(process.env));
      return [
        `**Enabled:** ${config.enabled ? 'yes' : 'no (off by default)'}`,
        `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set'}`,
        `**Idle threshold:** ${config.idleMinutes} minutes of silence`,
        `**Question source:** ${config.useAi ? (aiReady ? 'AI (detective provider), list fallback' : '⚠️ AI requested but no provider key — using the list') : `list (${questionBank().length} questions)`}`,
        '',
        '_After a starter, the next one waits for a human reply first — the bot never monologues._',
      ];
    },
    subcommands: [
      {
        name: 'on',
        description: 'Turn the chat starter on.',
        args: [],
        async run(ctx) {
          setStarterConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ The chat starter is **on**.');
        },
      },
      {
        name: 'off',
        description: 'Turn the chat starter off.',
        args: [],
        async run(ctx) {
          setStarterConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 The chat starter is **off**.');
        },
      },
      {
        name: 'channel',
        description: 'Channel to revive when it goes quiet.',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setStarterConfig(ctx.guild.id, { channelId: channel.id });
          await ctx.reply(`✅ The chat starter watches <#${channel.id}>.`);
        },
      },
      {
        name: 'idle',
        description: 'Minutes of silence before a starter (15–1440).',
        args: [{ name: 'minutes', type: 'integer', required: true }],
        async run(ctx, { minutes }) {
          if (minutes < 15 || minutes > 1440) {
            await ctx.reply('🚫 The idle threshold must be 15–1440 minutes.');
            return;
          }
          setStarterConfig(ctx.guild.id, { idleMinutes: minutes });
          await ctx.reply(`✅ A starter fires after **${minutes} minutes** of silence.`);
        },
      },
      {
        name: 'ai',
        description: 'Generate questions via the detective (falls back to the list).',
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setStarterConfig(ctx.guild.id, { useAi: state });
          await ctx.reply(state ? '✅ Questions come from the **AI** (list fallback).' : '✅ Questions come from the **list**.');
        },
      },
      {
        name: 'preview',
        description: 'Show a sample question (nothing is posted).',
        args: [],
        async run(ctx) {
          await ctx.channel.sendTyping?.().catch(() => {});
          const sample = await nextQuestion(ctx.guild.id, getStarterConfig(ctx.guild.id));
          await ctx.reply(`**Sample:** ${sample ?? '_question bank unavailable_'}`);
        },
      },
      {
        name: 'test',
        description: 'Post a REAL starter in the configured channel in ~30 seconds.',
        args: [],
        async run(ctx) {
          // Test shot (owner request S30): idle window and monologue guard
          // bypassed, so the owner sees the real thing without waiting hours.
          const config = getStarterConfig(ctx.guild.id);
          if (!config.channelId) {
            await ctx.reply('⚠️ No channel configured — nothing to arm.');
            return;
          }
          const guild = ctx.guild;
          const timer = setTimeout(() => {
            postStarter(guild, getStarterConfig(guild.id)).catch(() => {});
          }, TEST_DELAY_MS);
          timer.unref?.();
          await ctx.reply(`🧪 **Test armed:** a real starter hits <#${config.channelId}> in ~${Math.round(TEST_DELAY_MS / 1000)} seconds.`);
        },
      },
    ],
  },
};
