// The !mafia group (S105 = M24.1). Starting a table is open to everyone; the
// timings and the stats wipe are Manage Server.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { createGame } from '../lib/game.js';
import { MIN_PLAYERS, ROLES } from '../lib/roles.js';
import { rolesEmbed } from '../lib/render.js';
import { DEFAULT_MAFIA_CONFIG, humanizeMs } from '../lib/config.js';
import { clearTable, gameIn, getMafiaConfig, getStats, resetStats, setMafiaConfig, setTable } from '../service.js';
import { enterPhase } from '../flow.js';

const MEDALS = ['🥇', '🥈', '🥉'];
let counter = 0;
const nextGameId = () => `g${(counter += 1)}`;

export default {
  group: {
    name: 'mafia',
    aliases: ['mafiagame'],
    description: 'Classic mafia: one Boss, one medic, one detective, and a lot of arguing.',
    emoji: '🕵️',
    fallback: 'start', // `!mafia` with an unknown word still opens a table
    async status(ctx) {
      const game = gameIn(ctx.channel.id);
      const config = getMafiaConfig(ctx.guild.id);
      return [
        `**Table here:** ${game ? `🔴 in progress — ${game.phase}` : 'none'}`,
        `**Players needed:** ${MIN_PLAYERS}`,
        `**Phases:** night ${humanizeMs(config.nightMs)} · day ${humanizeMs(config.dayMs)} · vote ${humanizeMs(config.votingMs)} · trial ${humanizeMs(config.judgementMs)}`,
        '',
        `\`${ctx.prefix}mafia start\` opens a table · \`${ctx.prefix}mafia roles\` explains the cards.`,
      ];
    },
    subcommands: [
      {
        name: 'start',
        aliases: ['play', 'new'],
        description: 'Open a table in this channel.',
        args: [],
        async run(ctx) {
          if (gameIn(ctx.channel.id)) {
            await ctx.reply(`🕵️ There is already a table here. \`${ctx.prefix}mafia end\` closes it.`);
            return;
          }
          const game = { ...createGame(ctx.user.id), id: nextGameId() };
          setTable(ctx.channel.id, { game, messageId: null, timer: null });
          await enterPhase(ctx.channel, game);
        },
      },
      {
        name: 'end',
        aliases: ['stop', 'cancel'],
        description: 'Close the table here (host or Manage Server).',
        args: [],
        async run(ctx) {
          const game = gameIn(ctx.channel.id);
          if (!game) {
            await ctx.reply('🕵️ There is no table here.');
            return;
          }
          const mayEnd =
            game.hostId === ctx.user.id ||
            ctx.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild) ||
            ctx.guild.ownerId === ctx.user.id;
          if (!mayEnd) {
            await ctx.reply('🚫 Only the host or a server manager can close this table.');
            return;
          }
          clearTable(ctx.channel.id);
          await ctx.reply('🕵️ Table closed. Nobody finds out who anybody was.');
        },
      },
      {
        name: 'roles',
        aliases: ['cards'],
        description: 'What each card does.',
        args: [],
        async run(ctx) {
          await ctx.reply({ embeds: [new EmbedBuilder(rolesEmbed())] });
        },
      },
      {
        name: 'stats',
        aliases: ['me'],
        description: 'Your record at the table.',
        args: [{ name: 'member', type: 'user' }],
        async run(ctx, { member }) {
          const target = member ?? ctx.user;
          const row = getStats(ctx.guild.id)[target.id];
          if (!row || row.games === 0) {
            await ctx.reply({
              content: `🕵️ ${target.id === ctx.user.id ? 'You have' : `${target} has`} never sat at a table.`,
              allowedMentions: { parse: [] },
            });
            return;
          }
          const byRole = Object.entries(row.roles)
            .sort((a, b) => b[1].games - a[1].games)
            .map(([id, r]) => `${ROLES[id]?.emoji ?? '❔'} **${ROLES[id]?.name ?? id}** — ${r.wins}/${r.games}`)
            .join('\n');
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0x2f6f9f)
                .setTitle(`🕵️ ${target.username}’s record`)
                .setDescription(
                  `**${row.wins}** wins from **${row.games}** games (${Math.round((row.wins / row.games) * 100)}%).\n\n${byRole}`,
                ),
            ],
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'board',
        aliases: ['leaderboard', 'top'],
        description: 'The precinct’s best liars.',
        args: [{ name: 'size', type: 'integer', min: 1, max: 25 }],
        async run(ctx, { size = 10 }) {
          const rows = Object.entries(getStats(ctx.guild.id))
            .filter(([, r]) => r.games > 0)
            .sort((a, b) => b[1].wins - a[1].wins || b[1].games - a[1].games)
            .slice(0, size);
          const embed = new EmbedBuilder().setColor(0x2f6f9f).setTitle('🕵️ Mafia Board');
          embed.setDescription(
            rows.length === 0
              ? 'No games played yet.'
              : rows
                  .map(([id, r], i) => `${MEDALS[i] ?? `**${i + 1}.**`} <@${id}> — **${r.wins}** / ${r.games}`)
                  .join('\n'),
          );
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
      {
        name: 'timings',
        description: 'How long each phase lasts (seconds).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
          { name: 'phase', type: 'string', required: true, choices: ['night', 'day', 'voting', 'judgement', 'lobby'] },
          { name: 'seconds', type: 'integer', required: true, min: 15, max: 1800 },
        ],
        async run(ctx, { phase, seconds }) {
          const key = `${phase}Ms`;
          if (!(key in DEFAULT_MAFIA_CONFIG)) {
            await ctx.reply('🚫 Unknown phase.');
            return;
          }
          setMafiaConfig(ctx.guild.id, { [key]: seconds * 1000 });
          await ctx.reply(`🕵️ The **${phase}** phase now lasts **${seconds}s**.`);
        },
      },
      {
        name: 'reset',
        description: 'Wipe every mafia record (irreversible).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'confirm', type: 'string', choices: ['confirm'] }],
        async run(ctx, { confirm }) {
          if (confirm !== 'confirm') {
            await ctx.reply(`🚫 That wipes every record. Run \`${ctx.prefix}mafia reset confirm\` if you mean it.`);
            return;
          }
          resetStats(ctx.guild.id);
          await ctx.reply('🕵️ Every record is gone.');
        },
      },
    ],
  },
};
