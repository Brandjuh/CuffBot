// The !memory group (S82 = M16.9, AAA3A memorygame port): single-player pair
// matching on a 3x3/4x4/5x5 button grid — mismatches flash red for a second,
// a win pays a prize that decays with time and wrong matches.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import {
  BLANK,
  DEFAULT_DIFFICULTY,
  DIFFICULTIES,
  MAX_WRONG_MAX,
  MAX_WRONG_MIN,
  PRIZE_MAX,
  PRIZE_MIN,
  REDUCTION_MAX,
  REDUCTION_MIN,
  gridSize,
} from '../lib/game.js';
import {
  armIdleTimer,
  createMemoryGame,
  endMemoryGame,
  getMemoryConfig,
  getMemoryStats,
  markStarted,
  recordGamePlayed,
  resetMemoryStats,
  setMemoryConfig,
  topMemory,
} from '../service.js';

const TEAL = 0x11806a;

/**
 * The button grid. Hidden tiles show the invisible label; the first pick of a
 * pair reveals its label in place (no style change — cog behavior); matched
 * pairs stay green; a mismatch flash paints both red for a second; a win
 * reveals the whole board green.
 */
export function boardComponents(game, { flash = null, revealAll = false, disableAll = false } = {}) {
  const size = gridSize(game.difficulty);
  const rows = [];
  for (let row = 0; row < size; row += 1) {
    rows.push(
      new ActionRowBuilder().addComponents(
        Array.from({ length: size }, (_, col) => {
          const index = row * size + col;
          const emoji = game.tiles[index];
          const blank = emoji === BLANK;
          const flashed = flash !== null && (index === flash.first || index === flash.second);
          const found = !blank && game.found.includes(emoji);
          const revealed = !blank && (flashed || found || revealAll || game.selected === index);
          return new ButtonBuilder()
            .setCustomId(`mem:pick:${game.id}:${index}`)
            .setLabel(revealed ? emoji : BLANK)
            .setStyle(
              flashed ? ButtonStyle.Danger
              : found || revealAll ? ButtonStyle.Success
              : ButtonStyle.Secondary,
            )
            .setDisabled(blank || disableAll);
        }),
      ),
    );
  }
  return rows;
}

const authorOf = (member, user) => ({
  name: member?.displayName ?? user.username,
  iconURL: user.displayAvatarURL(),
});

export function gameEmbed(author) {
  return new EmbedBuilder()
    .setColor(TEAL)
    .setTitle('Memory Game')
    .setDescription('Find all the pairs of emojis!')
    .setAuthor(author);
}

export function winEmbed(result, author) {
  return new EmbedBuilder()
    .setColor(TEAL)
    .setTitle('Memory Game')
    .setDescription(
      `You won in ${result.seconds} seconds, with ${result.tries} tries and ${result.wrongMatches} wrong matches!` +
        ` You win **${result.prize.toLocaleString('en-US')}** scoreboard points${result.paid ? ' and the same in 🍩' : ''}!`,
    )
    .setAuthor(author);
}

export function loseEmbed(game, author) {
  return new EmbedBuilder()
    .setColor(TEAL)
    .setTitle('Memory Game')
    .setDescription(
      `You lose, because you tried too many times (${game.tries} tries and ${game.wrongMatches} wrong matches).`,
    )
    .setAuthor(author);
}

/** (Re-)arm the cog's 10-minute idle timeout: silently disable the board. */
export function armIdle(game) {
  armIdleTimer(game, async () => {
    endMemoryGame(game.id);
    await game.message?.edit({ components: boardComponents(game, { disableAll: true }) }).catch(() => {});
  });
}

export default {
  group: {
    name: 'memory',
    aliases: ['memorygame'],
    description: 'Memory: flip tiles, find the emoji pairs — fast and precise pays best.',
    emoji: '🧠',
    fallback: 'play', // `!memory 3x3` reads like the cog's `!memorygame 3x3`
    status(ctx) {
      const config = getMemoryConfig(ctx.guild.id);
      const mine = getMemoryStats(ctx.guild.id).players[ctx.user.id];
      return [
        `Start a board with \`${ctx.prefix}memory play [${DIFFICULTIES.join('|')}]\` (default ${DEFAULT_DIFFICULTY}) and find every pair. A wrong pair flashes red and hides again; boards idle out after 10 minutes.`,
        '',
        `**Prize ceiling:** ${config.maxPrize.toLocaleString('en-US')} points (5x5 pays full, 4x4 ⅔, 3x3 ⅓) — decays **−${config.reductionPerSecond}/second** and **−${config.reductionPerWrongMatch}/wrong match**${config.economy ? ', paid in 🍩 too (economy ON)' : ' (economy payout off)'}`,
        `**Wrong-match limit:** ${config.maxWrongMatches > 0 ? `${config.maxWrongMatches} — one too many loses the game` : 'none'}`,
        ...(mine
          ? [
              `**Your record:** ${mine.score.toLocaleString('en-US')} points · ${mine.wins} win${mine.wins === 1 ? '' : 's'} · ${mine.games} game${mine.games === 1 ? '' : 's'}`,
            ]
          : []),
      ];
    },
    subcommands: [
      {
        name: 'play',
        aliases: ['start'],
        description: `Start a board (${DIFFICULTIES.join('/')}, default ${DEFAULT_DIFFICULTY}) — yours alone.`,
        args: [{ name: 'difficulty', type: 'string', required: false, choices: DIFFICULTIES }],
        async run(ctx, { difficulty }) {
          const game = createMemoryGame(ctx.channel.id, ctx.guild.id, ctx.user.id, {
            difficulty: difficulty ?? DEFAULT_DIFFICULTY,
          });
          recordGamePlayed(ctx.guild.id, ctx.user.id); // games count at START (cog)
          const message = await ctx.reply({
            embeds: [gameEmbed(authorOf(ctx.member, ctx.user))],
            components: boardComponents(game),
          });
          if (!message) {
            endMemoryGame(game.id);
            return;
          }
          game.message = message;
          markStarted(game); // the clock starts once the board is visible (cog)
          armIdle(game);
        },
      },
      {
        name: 'leaderboard',
        aliases: ['lb'],
        description: 'The memory scoreboard: score, wins, games.',
        args: [],
        async run(ctx) {
          const sorted = topMemory(ctx.guild.id);
          if (sorted.length === 0) {
            await ctx.reply('No one has played this game yet.');
            return;
          }
          const medals = ['🥇', '🥈', '🥉'];
          const lines = sorted
            .slice(0, 15)
            .map(
              (p, i) =>
                `${medals[i] ?? `**${i + 1}.**`} <@${p.id}> — **${p.score.toLocaleString('en-US')}** points · ${p.wins} win${p.wins === 1 ? '' : 's'} · ${p.games} game${p.games === 1 ? '' : 's'}`,
            );
          const place = sorted.findIndex((p) => p.id === ctx.user.id);
          const embed = new EmbedBuilder()
            .setColor(TEAL)
            .setTitle('🧠 Memory — Leaderboard')
            .setDescription(lines.join('\n'));
          if (place !== -1) embed.setFooter({ text: `You: ${place + 1}/${sorted.length}` });
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
      {
        name: 'maxwrong',
        description: `Wrong matches allowed per game (${MAX_WRONG_MIN}–${MAX_WRONG_MAX}, 0 = no limit).`,
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'limit', type: 'integer', required: true }],
        async run(ctx, { limit }) {
          if (limit < MAX_WRONG_MIN || limit > MAX_WRONG_MAX) {
            await ctx.reply(`🚫 The limit must be ${MAX_WRONG_MIN}–${MAX_WRONG_MAX} (0 = no limit).`);
            return;
          }
          setMemoryConfig(ctx.guild.id, { maxWrongMatches: limit });
          await ctx.reply(
            limit === 0
              ? '✅ No wrong-match limit — take your time.'
              : `✅ Games now end in a loss after **${limit}** wrong matches.`,
          );
        },
      },
      {
        name: 'maxprize',
        description: `The prize ceiling before decay (${PRIZE_MIN}–${PRIZE_MAX}, default 5000).`,
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'amount', type: 'integer', required: true }],
        async run(ctx, { amount }) {
          if (amount < PRIZE_MIN || amount > PRIZE_MAX) {
            await ctx.reply(`🚫 The prize ceiling must be ${PRIZE_MIN}–${PRIZE_MAX}.`);
            return;
          }
          setMemoryConfig(ctx.guild.id, { maxPrize: amount });
          await ctx.reply(
            `✅ The memory prize ceiling is **${amount.toLocaleString('en-US')}** (5x5 pays full, 4x4 ⅔, 3x3 ⅓ — minus decay).`,
          );
        },
      },
      {
        name: 'decay',
        description: `Prize decay per second and per wrong match (${REDUCTION_MIN}–${REDUCTION_MAX} each; defaults 5 and 15).`,
        permission: PermissionFlagsBits.ManageGuild,
        args: [
          { name: 'persecond', type: 'integer', required: true },
          { name: 'perwrong', type: 'integer', required: true },
        ],
        async run(ctx, { persecond, perwrong }) {
          if (
            persecond < REDUCTION_MIN || persecond > REDUCTION_MAX ||
            perwrong < REDUCTION_MIN || perwrong > REDUCTION_MAX
          ) {
            await ctx.reply(`🚫 Both decay values must be ${REDUCTION_MIN}–${REDUCTION_MAX}.`);
            return;
          }
          setMemoryConfig(ctx.guild.id, { reductionPerSecond: persecond, reductionPerWrongMatch: perwrong });
          await ctx.reply(`✅ Prize decay: **−${persecond}** per second and **−${perwrong}** per wrong match.`);
        },
      },
      {
        name: 'economy',
        description: 'Also pay the prize in donuts through the economy (the cog’s red_economy).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setMemoryConfig(ctx.guild.id, { economy: state });
          await ctx.reply(state ? '✅ Winners are paid in 🍩 on top of scoreboard points.' : '✅ Scoreboard points only.');
        },
      },
      {
        name: 'resetleaderboard',
        description: 'Wipe the memory scoreboard for this precinct.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {
          resetMemoryStats(ctx.guild.id);
          await ctx.reply('🗑️ Memory leaderboard reset.');
        },
      },
    ],
  },
};
