// The shared minigames surface (M26.2b): stats, configuration, and the cog's
// sortable leaderboard.
//
// S116 hung `stats` and `board` off the `!connect4` group, because Connect 4
// was the only game. Tic-Tac-Toe writes to the same counters — the cog pools
// both games too — so leaving them there would have meant `!connect4 board`
// showing Tic-Tac-Toe results. They live here instead, and the duplicates are
// gone rather than aliased: the owner's own complaint about `!city`/`!crime`
// was exactly two names for one thing.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import {
  LEADERBOARD_SORTS,
  gamesOf,
  getMinigamesConfig,
  getStats,
  leaderboard,
  playerStats,
  setMinigamesConfig,
  winRateOf,
} from '../service.js';

const ARCADE = 0x9b59b6;
const money = (n) => Number(n).toLocaleString('en-US');
const SORTS = Object.keys(LEADERBOARD_SORTS);

/** The stats card — shared by `!minigames stats` and nothing else, yet. */
function statsEmbed(guildId, who, isOther) {
  const p = playerStats(getStats(guildId), who.id);
  const total = gamesOf(p);
  return new EmbedBuilder()
    .setColor(ARCADE)
    .setTitle(`🎮 Minigames — ${isOther ? (who.displayName ?? who.username) : 'your record'}`)
    .setDescription(
      total === 0
        ? 'No games yet. `!connect4` or `!tictactoe` starts one.'
        : [
            `**Won:** ${p.wins} · **Lost:** ${p.losses} · **Tied:** ${p.ties}`,
            `**Win rate:** ${winRateOf(p).toFixed(1)}% over ${total} game${total === 1 ? '' : 's'}`,
            `**Earnings:** ${p.earnings >= 0 ? '+' : '−'}${money(Math.abs(p.earnings))} 🍩`,
          ].join('\n'),
    )
    .setFooter({ text: 'Connect 4 and Tic-Tac-Toe share one record. Games against the bot are not counted.' });
}

export const minigamesGroup = {
  group: {
    name: 'minigames',
    aliases: ['mgset'],
    description: 'The arcade desk: your record, and the buy-in the games run on.',
    emoji: '🎮',
    invokeWithoutSubcommand: true,
    fallback: 'stats',
    status(ctx) {
      const config = getMinigamesConfig(ctx.guild.id);
      return [
        `Two games, both panel-driven: \`${ctx.prefix}connect4\` and \`${ctx.prefix}tictactoe\`. Name an officer to challenge them, or leave it blank to play the bot.`,
        '',
        `**Buy-in:** ${config.betAmount === 0 ? 'free' : `${money(config.betAmount)} 🍩 each`}`,
        `**Winner takes:** ${config.betAmount === 0 ? '—' : `${money(config.winMin)}–${money(config.winMax)} 🍩`}`,
        `**Staked against the bot:** ${config.betVsBot === false ? 'no' : 'yes'}`,
        '',
        `\`${ctx.prefix}gameleaderboard <${SORTS.join('|')}>\` ranks the precinct · \`${ctx.prefix}minigames stats\` is your own record.`,
      ];
    },
    subcommands: [
      {
        name: 'stats',
        aliases: ['record', 'me'],
        description: 'Your minigames record, or someone else’s.',
        args: [{ name: 'member', type: 'user' }],
        async run(ctx, { member = null }) {
          await ctx.reply({
            embeds: [statsEmbed(ctx.guild.id, member ?? ctx.user, Boolean(member))],
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'bet',
        description: 'Set the buy-in each player pays. 0 turns staking off.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'amount', type: 'integer', required: true }],
        async run(ctx, { amount }) {
          if (amount < 0) {
            await ctx.reply('🎮 The buy-in cannot be negative.');
            return;
          }
          setMinigamesConfig(ctx.guild.id, { betAmount: amount });
          await ctx.reply(
            amount === 0
              ? '🎮 Staking is off — games are free, and nothing is paid out.'
              : `🎮 Buy-in set to **${money(amount)} 🍩** per player.`,
          );
        },
      },
      {
        name: 'winmin',
        description: 'The bottom of the prize range.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'amount', type: 'integer', required: true }],
        async run(ctx, { amount }) {
          const config = getMinigamesConfig(ctx.guild.id);
          if (amount < 0) {
            await ctx.reply('🎮 The prize cannot be negative.');
            return;
          }
          if (amount > config.winMax) {
            await ctx.reply(`🎮 The minimum cannot be above the maximum (**${money(config.winMax)} 🍩**).`);
            return;
          }
          setMinigamesConfig(ctx.guild.id, { winMin: amount });
          await ctx.reply(`🎮 Prize range is now **${money(amount)}–${money(config.winMax)} 🍩**.`);
        },
      },
      {
        name: 'winmax',
        description: 'The top of the prize range.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'amount', type: 'integer', required: true }],
        async run(ctx, { amount }) {
          const config = getMinigamesConfig(ctx.guild.id);
          if (amount < config.winMin) {
            await ctx.reply(`🎮 The maximum cannot be below the minimum (**${money(config.winMin)} 🍩**).`);
            return;
          }
          setMinigamesConfig(ctx.guild.id, { winMax: amount });
          await ctx.reply(`🎮 Prize range is now **${money(config.winMin)}–${money(amount)} 🍩**.`);
        },
      },
      {
        name: 'betvsbot',
        description: 'Whether games against the bot are played for donuts.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'on', type: 'boolean', required: true }],
        async run(ctx, { on }) {
          const config = setMinigamesConfig(ctx.guild.id, { betVsBot: on });
          await ctx.reply(
            on
              ? `🎮 Games against me are staked — the cog's own behaviour. Beating me pays **${money(config.winMin)}–${money(config.winMax)} 🍩** for a **${money(config.betAmount)} 🍩** buy-in.`
              : '🎮 Games against me are free and pay nothing. Officer-versus-officer games still stake.',
          );
        },
      },
    ],
  },
};

export const gameLeaderboardCommand = {
  command: {
    name: 'gameleaderboard',
    aliases: ['glb', 'gtop'],
    description: 'The precinct’s minigame leaderboard, sorted your way.',
    emoji: '🏆',
    args: [{ name: 'sort', type: 'string', choices: SORTS }],
    async run(ctx, { sort = 'wins' }) {
      const key = SORTS.includes(sort) ? sort : 'wins';
      const spec = LEADERBOARD_SORTS[key];
      const rows = leaderboard(ctx.guild.id, key);
      const medals = ['🥇', '🥈', '🥉'];
      await ctx.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(ARCADE)
            .setTitle(`🏆 Minigames — top ${spec.label.toLowerCase()}`)
            .setDescription(
              rows.length === 0
                ? 'Nobody has finished a game yet.'
                : rows.map((r, i) => `${medals[i] ?? `\`#${i + 1}\``} <@${r.id}> — **${spec.render(r)}**`).join('\n'),
            )
            .setFooter({ text: `${ctx.prefix}gameleaderboard <${SORTS.join(' | ')}>` }),
        ],
        allowedMentions: { parse: [] },
      });
    },
  },
};

export default minigamesGroup;
