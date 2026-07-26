// The crook-hunt admin group (S70 = M17.2): channels, timing, catch mode,
// rewards, and the instant test spawn. Bare `!hunting` = the precinct status.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { CROOKS } from '../lib/hunt.js';
import {
  getHuntingConfig,
  getScores,
  huntingAvailable,
  nextSpawnInfo,
  setHuntingConfig,
  spawnCrook,
  topHunters,
} from '../service.js';
import { formatWaitMs } from '../../economy/lib/bank.js';

export default {
  group: {
    name: 'hunting',
    aliases: ['hunt-stats', 'hunt-board', 'hunt'],
    description: 'The crook hunt: channels, timing, catch mode, rewards (admin).',
    emoji: '🦹',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getHuntingConfig(ctx.guild.id);
      const wait = nextSpawnInfo(ctx.guild.id);
      const intentLine = huntingAvailable(ctx.client, config)
        ? config.mode === 'words'
          ? '✅ Words mode — STOP POLICE shouts are heard.'
          : '✅ Reaction mode — 🚨 presses count (works without Message Content).'
        : `⚠️ **Words mode needs the Message Content intent** — no crooks will spawn. Switch with \`${ctx.prefix}hunting mode reaction\`, or enable the intent.`;
      return [
        `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
        `**Hunting in:** ${config.channels.length ? config.channels.map((id) => `<#${id}>`).join(' ') : `_no channels — add one with \`${ctx.prefix}hunting add\`_`}`,
        `**Between crooks:** ${Math.round(config.intervalMinS / 60)}–${Math.round(config.intervalMaxS / 60)} min · **escape after:** ${config.catchTimeoutS} s`,
        `**Catch:** ${config.mode === 'words' ? 'shout **STOP POLICE**' : 'press 🚨'} · **bounty:** ${config.rewardMin}–${config.rewardMax} 🍩`,
        `**Undercover officer:** ${config.undercover ? 'on the beat — salute 🫡, don’t cuff' : 'off'} · **response time:** ${config.showTime ? 'shown' : 'hidden'}`,
        `**Next crook:** ${wait === null ? 'the clock arms on the next message in a hunt channel' : wait === 0 ? 'any moment now' : `~${formatWaitMs(wait)}`}`,
        '',
        `**Wanted board:** ${CROOKS.map((c) => c.emoji).join(' ')}`,
        intentLine,
      ];
    },
    subcommands: [
      {
        // S106: was `!hunting stats`. Public inside an admin group — `permission:
        // null` drops the group's gate, and the overview filters per viewer.
        name: 'stats',
        aliases: ['record', 'me'],
        description: 'A hunter’s arrest record: catches per crook type.',
        permission: null,
        args: [{ name: 'member', type: 'user' }], // default: you
        async run(ctx, { member }) {

          const target = member ?? ctx.user;
          const record = getScores(ctx.guild.id)[target.id];
          if (!record?.total) {
            await ctx.reply(
              '🦹 Cuff a crook before you brag about it — shout **STOP POLICE** when one appears.',
            );
            return;
          }
          const lines = CROOKS.filter((c) => record.byCrook?.[c.id]).map(
            (c) => `${c.emoji} ${c.id.replace(/-/g, ' ')} — **${record.byCrook[c.id]}**`,
          );
          const embed = new EmbedBuilder()
            .setColor(0x1f8b4c)
            .setTitle(`🚔 Arrest record — ${target.username}`)
            .setDescription(
              [`**${record.total}** crook${record.total === 1 ? '' : 's'} cuffed in total`, '', ...lines].join('\n'),
            );
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
      {
        // S106: was `!hunting board`.
        name: 'board',
        aliases: ['leaderboard', 'top'],
        description: 'The precinct’s top crook hunters (top 25 by total catches).',
        permission: null,
        args: [],
        async run(ctx) {

          const top = topHunters(ctx.guild.id, 25);
          if (top.length === 0) {
            await ctx.reply('🦹 Nobody has cuffed a crook yet — the board is wide open.');
            return;
          }
          const medals = ['🥇', '🥈', '🥉'];
          const lines = top.map(
            (r, i) => `${medals[i] ?? `**${i + 1}.**`} <@${r.userId}> — **${r.total.toLocaleString('en-US')}**`,
          );
          const embed = new EmbedBuilder()
            .setColor(0x1f8b4c)
            .setTitle('🏆 Hunting Leaderboard')
            .setDescription(lines.join('\n'));
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
      {
        name: 'on',
        description: 'Turn the crook hunt on.',
        args: [],
        async run(ctx) {
          setHuntingConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ The hunt is **on**.');
        },
      },
      {
        name: 'off',
        description: 'Turn the crook hunt off.',
        args: [],
        async run(ctx) {
          setHuntingConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 The hunt is **off**.');
        },
      },
      {
        name: 'add',
        description: 'Start hunting in a channel.',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          const current = getHuntingConfig(ctx.guild.id);
          if (current.channels.includes(channel.id)) {
            await ctx.reply(`ℹ️ Already hunting in <#${channel.id}>.`);
            return;
          }
          setHuntingConfig(ctx.guild.id, { channels: [...current.channels, channel.id] });
          await ctx.reply(`✅ The hunt is on in <#${channel.id}>.`);
        },
      },
      {
        name: 'remove',
        description: 'Stop hunting in a channel.',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          const current = getHuntingConfig(ctx.guild.id);
          setHuntingConfig(ctx.guild.id, {
            channels: current.channels.filter((id) => id !== channel.id),
          });
          await ctx.reply(`🛑 Hunt stopped in <#${channel.id}>.`);
        },
      },
      {
        name: 'mode',
        description: 'How crooks are caught: shout STOP POLICE, or press 🚨.',
        args: [{ name: 'mode', type: 'string', required: true, choices: ['words', 'reaction'] }],
        async run(ctx, { mode }) {
          setHuntingConfig(ctx.guild.id, { mode });
          await ctx.reply(
            mode === 'words'
              ? '✅ Words mode — crooks are caught by shouting **STOP POLICE**.'
              : '✅ Reaction mode — crooks are caught by pressing 🚨.',
          );
        },
      },
      {
        name: 'showtime',
        description: 'Show (or hide) the response time on catches.',
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setHuntingConfig(ctx.guild.id, { showTime: state });
          await ctx.reply(state ? '⏱️ Response times are **shown** on catches.' : '⏱️ Response times are **hidden**.');
        },
      },
      {
        name: 'undercover',
        description: 'The undercover-officer special (salute 🫡, don’t cuff).',
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setHuntingConfig(ctx.guild.id, { undercover: state });
          await ctx.reply(state ? '🕶️ The undercover officer is **on the beat**.' : '🕶️ The undercover officer is **off duty**.');
        },
      },
      {
        name: 'rewards',
        description: 'Bounty range per catch, in donuts.',
        args: [
          { name: 'min', type: 'integer', required: true },
          { name: 'max', type: 'integer', required: true },
        ],
        async run(ctx, { min, max }) {
          if (min < 0 || max > 100_000 || min > max) {
            await ctx.reply('🚫 Give a range like `100 300` — min ≥ 0, max ≤ 100000, min ≤ max.');
            return;
          }
          setHuntingConfig(ctx.guild.id, { rewardMin: min, rewardMax: max });
          await ctx.reply(`💰 Bounty set to **${min}–${max} 🍩** per catch.`);
        },
      },
      {
        name: 'interval',
        description: 'Seconds between crooks (random within the range).',
        args: [
          { name: 'min', type: 'integer', required: true },
          { name: 'max', type: 'integer', required: true },
        ],
        async run(ctx, { min, max }) {
          if (min < 60 || max > 86_400 || min > max) {
            await ctx.reply('🚫 Give a range in seconds like `900 3600` — min ≥ 60, max ≤ 86400, min ≤ max.');
            return;
          }
          setHuntingConfig(ctx.guild.id, { intervalMinS: min, intervalMaxS: max });
          await ctx.reply(`⏲️ A crook appears every **${Math.round(min / 60)}–${Math.round(max / 60)} min**.`);
        },
      },
      {
        name: 'timeout',
        description: 'Seconds before an uncaught crook escapes (10–600).',
        args: [{ name: 'seconds', type: 'integer', required: true }],
        async run(ctx, { seconds }) {
          if (seconds < 10 || seconds > 600) {
            await ctx.reply('🚫 The escape window must be 10–600 seconds.');
            return;
          }
          setHuntingConfig(ctx.guild.id, { catchTimeoutS: seconds });
          await ctx.reply(`🏃 Crooks escape after **${seconds} s**.`);
        },
      },
      {
        name: 'spawn',
        aliases: ['test-spawn'],
        description: 'Spawn one crook RIGHT NOW (in the given channel, or here).',
        args: [{ name: 'channel', type: 'channel', required: false, postable: true }],
        async run(ctx, { channel }) {
          const target = channel ?? ctx.channel;
          const spawned = await spawnCrook(target, {});
          await ctx.reply(
            spawned
              ? `🧪 A crook just appeared in <#${target.id}> — go get them!`
              : '⚠️ Test spawn failed (no send access, or a hunt is already open there).',
          );
        },
      },
    ],
  },
};
