// The !killcounter group (S99 = M20, owner request). The owner named the
// feature, so the command keeps their word; the flavour is the precinct's.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { leaderboard, standingFor } from '../lib/killcounter.js';
import {
  getKillCounterConfig,
  getScores,
  resetScores,
  setKillCounterConfig,
} from '../service.js';

const MEDALS = ['🥇', '🥈', '🥉'];
const seconds = (ms) => `${Math.round(ms / 1000)} s`;

export default {
  group: {
    name: 'killcounter',
    aliases: ['kills', 'chatkills'],
    description: 'Chat kills: go quiet after someone speaks and the last word scores.',
    emoji: '💀',
    fallback: 'me', // `!killcounter @member` reads as `!killcounter me @member`
    async status(ctx) {
      const config = getKillCounterConfig(ctx.guild.id);
      const mine = standingFor(getScores(ctx.guild.id), ctx.user.id);
      return [
        `**Enabled:** ${config.enabled ? '🟢 yes' : '🔴 no'}`,
        `**Silence needed:** ${seconds(config.silenceMs)}`,
        `**Channels:** ${
          config.channelIds.length === 0
            ? 'everywhere'
            : config.channelIds.map((id) => `<#${id}>`).join(', ')
        }`,
        `**Your kills:** ${mine.kills}${mine.rank ? ` — #${mine.rank} of ${mine.of}` : ''}`,
      ];
    },
    subcommands: [
      {
        name: 'me',
        aliases: ['stats'],
        description: 'How many conversations you have killed.',
        args: [{ name: 'member', type: 'user' }], // default: you
        async run(ctx, { member }) {
          const target = member ?? ctx.user;
          const standing = standingFor(getScores(ctx.guild.id), target.id);
          const who = target.id === ctx.user.id ? 'You have' : `${target} has`;
          await ctx.reply({
            content:
              standing.kills === 0
                ? `💀 ${who} not killed a single conversation. Impressive restraint.`
                : `💀 ${who} **${standing.kills}** chat kill${standing.kills === 1 ? '' : 's'} — #${standing.rank} of ${standing.of}.`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'board',
        aliases: ['leaderboard', 'top'],
        description: 'The precinct’s deadliest conversationalists.',
        args: [{ name: 'size', type: 'integer', min: 1, max: 25 }], // default 10
        async run(ctx, { size = 10 }) {
          const rows = leaderboard(getScores(ctx.guild.id), size);
          const embed = new EmbedBuilder().setColor(0x4a4a4a).setTitle('💀 Chat Kill Board');
          if (rows.length === 0) {
            embed.setDescription('No conversations have died yet. The precinct is unusually chatty.');
          } else {
            embed.setDescription(
              rows
                .map(
                  ({ userId, kills }, i) =>
                    `${MEDALS[i] ?? `**${i + 1}.**`} <@${userId}> — **${kills}**`,
                )
                .join('\n'),
            );
            embed.setFooter({
              text: `Say the last word and let ${seconds(getKillCounterConfig(ctx.guild.id).silenceMs)} pass.`,
            });
          }
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
      {
        name: 'on',
        description: 'Start counting chat kills.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          setKillCounterConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('💀 Chat kills are being counted.');
        },
      },
      {
        name: 'off',
        description: 'Stop counting chat kills.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          setKillCounterConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('💀 Chat kills are no longer counted. Existing scores are kept.');
        },
      },
      {
        name: 'silence',
        description: 'How long the quiet must last to score (5–3600 seconds).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'seconds', type: 'integer', required: true, min: 5, max: 3600 }],
        async run(ctx, { seconds: value }) {
          setKillCounterConfig(ctx.guild.id, { silenceMs: value * 1000 });
          await ctx.reply(`💀 A kill now needs **${value} s** of silence.`);
        },
      },
      {
        name: 'channel',
        description: 'Count only in these channels — run it per channel to add.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'channel', type: 'channel', required: true }],
        async run(ctx, { channel }) {
          const config = getKillCounterConfig(ctx.guild.id);
          const set = new Set(config.channelIds);
          const removed = set.delete(channel.id);
          if (!removed) set.add(channel.id);
          const next = setKillCounterConfig(ctx.guild.id, { channelIds: [...set] });
          await ctx.reply({
            content: removed
              ? `💀 ${channel} is no longer counted.${next.channelIds.length === 0 ? ' The list is empty, so kills count **everywhere** again.' : ''}`
              : `💀 ${channel} added — kills now count **only** in ${next.channelIds.map((id) => `<#${id}>`).join(', ')}.`,
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'everywhere',
        description: 'Count in every channel again (clears the channel list).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          setKillCounterConfig(ctx.guild.id, { channelIds: [] });
          await ctx.reply('💀 Chat kills count in **every** channel again.');
        },
      },
      {
        name: 'reset',
        description: 'Wipe every score (irreversible).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'confirm', type: 'string', choices: ['confirm'] }],
        async run(ctx, { confirm }) {
          if (confirm !== 'confirm') {
            await ctx.reply(
              `🚫 That wipes every score. Run \`${ctx.prefix}killcounter reset confirm\` if you mean it.`,
            );
            return;
          }
          resetScores(ctx.guild.id);
          await ctx.reply('💀 The board is clean. Nobody has killed anything.');
        },
      },
    ],
  },
};
