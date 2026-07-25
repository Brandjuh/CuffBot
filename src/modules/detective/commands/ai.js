// The detective (AI) admin group (S70 = M17.2, `!ai` — the old `!ai-config`
// name stays as an alias). Bare `!ai` shows provider, limits, and usage.
import { PermissionFlagsBits } from 'discord.js';
import { getAiConfig, setAiConfig, detectiveStatus, pendingCount } from '../service.js';

export default {
  group: {
    name: 'ai',
    aliases: ['ai-config'],
    description: 'The detective (AI): channel lock, provider status, usage (admin).',
    emoji: '🕵️',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getAiConfig(ctx.guild.id);
      const s = detectiveStatus(ctx.guild.id);
      return [
        `**Enabled:** ${s.enabled ? 'yes' : 'no'}`,
        `**Channel:** ${config.channelId ? `<#${config.channelId}> — the detective only answers there (S51)` : 'everywhere'}`,
        `**Provider:** ${s.provider ? `${s.provider} (model \`${s.model}\`)` : '⚠️ none — add `GROQ_API_KEY` or `GEMINI_API_KEY` to `.env` and restart'}`,
        `**Rate limit (server-wide, everyone combined):** 1 question / 7 s · max 62 / hour${s.maxPerDay ? ` · max ${s.maxPerDay} / day (free ${s.provider} tier)` : ''}`,
        `**Used this hour:** ${s.usedThisHour} / ${s.maxPerHour}${s.maxPerDay ? ` · **today:** ${s.usedToday} / ${s.maxPerDay}` : ''}`,
        ...(s.tpm ? [`**Token budget (est.):** ${s.tokensThisMinute.toLocaleString('en-US')} / ${s.tpm.toLocaleString('en-US')} this minute${s.tpd ? ` · ${s.tokensToday.toLocaleString('en-US')} / ${s.tpd.toLocaleString('en-US')} today` : ''}`] : []),
        `**Desk pile (parked questions):** ${pendingCount()}`,
        `**Conversation memory:** last ${s.historyLimits.maxHistoryEntries} exchanges per channel, ${Math.round(s.historyLimits.historyTtlMs / 60000)} min`,
        '',
        `Talk to the detective with \`${ctx.prefix}ask …\` or by mentioning the bot in a message.`,
      ];
    },
    subcommands: [
      {
        name: 'on',
        description: 'Put the detective on duty.',
        args: [],
        async run(ctx) {
          setAiConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ The detective is **on duty**.');
        },
      },
      {
        name: 'off',
        description: 'Send the detective home.',
        args: [],
        async run(ctx) {
          setAiConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 The detective is **off duty**.');
        },
      },
      {
        name: 'channel',
        description: 'The ONLY channel where !ask and mention-replies work (S51).',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setAiConfig(ctx.guild.id, { channelId: channel.id });
          await ctx.reply(`✅ The detective only answers in <#${channel.id}>.`);
        },
      },
      {
        name: 'everywhere',
        description: 'Lift the channel restriction — the detective answers anywhere.',
        args: [],
        async run(ctx) {
          setAiConfig(ctx.guild.id, { channelId: null });
          await ctx.reply('✅ The detective answers **everywhere**.');
        },
      },
    ],
  },
};
