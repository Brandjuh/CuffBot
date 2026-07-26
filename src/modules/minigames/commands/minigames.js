// The `!connect4` group for the new minigames module (M26.2a).
//
// The command exists only to OPEN the panel. Everything after that happens on
// the panel itself — which is the correction this whole milestone is: the
// source cog is panel-driven, and S71/S100 shipped a command per action.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { NONE, RED, TIE, chooseColumn, newGame, playColumn } from '../lib/connect4.js';
import { connect4Panel } from '../lib/panel.js';
import {
  channelAvailability,
  createSession,
  getGame,
  getStats,
  leaderboard,
  playerStats,
  recordResult,
  seatOf,
  touch,
} from '../service.js';

const STYLES = {
  success: ButtonStyle.Success,
  secondary: ButtonStyle.Secondary,
  primary: ButtonStyle.Primary,
  danger: ButtonStyle.Danger,
};

/** Turn the pure panel description into a discord.js message payload. */
export function payloadFor(game) {
  const panel = connect4Panel(game);
  const buttons = panel.buttons.map((b) => {
    const button = new ButtonBuilder().setCustomId(`mg:${game.id}:${b.id}`).setStyle(STYLES[b.style]);
    if (b.emoji) button.setEmoji(b.emoji);
    if (b.label) button.setLabel(b.label);
    return button.setDisabled(Boolean(b.disabled));
  });
  // Discord allows five buttons per row; seven columns therefore need two.
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + 5)));
  }
  return {
    content: panel.content ?? undefined,
    embeds: [new EmbedBuilder().setTitle(panel.embed.title).setDescription(panel.embed.description).setColor(panel.embed.color)],
    components: rows,
    allowedMentions: { parse: ['users'] },
  };
}

/** The bot moves if it is the bot's turn. Exported so the pump can reuse it. */
export function botMoveIfDue(game, random = Math.random) {
  while (!game.finished && game.state.winner === NONE && game.players[game.state.current]?.bot) {
    game.state = playColumn(game.state, chooseColumn(game.state.board, game.state.current, random));
  }
  return settleIfOver(game);
}

/**
 * Mark a finished game finished, and write the result exactly once.
 *
 * The `finished` flag is what makes it once-only: every path that can end a
 * game (a human move, a bot move, the final move of a rematch) funnels through
 * here, and a second call is a no-op. Recording twice would double a player's
 * win on a single game — the same claim-before-act shape as S22.
 */
export function settleIfOver(game) {
  if (game.finished || game.state.winner === NONE) return game;
  game.finished = true;
  const [red, blue] = game.players;
  // Games against the bot do not touch the scoreboard: a human record is only
  // meaningful against other humans, and the cog's own stats work the same way.
  if (!game.againstBot) {
    if (game.state.winner === TIE) recordResult(game.guildId, { tie: [red.id, blue.id] });
    else {
      const winner = game.players[game.state.winner];
      const loser = game.players[game.state.winner === 0 ? 1 : 0];
      recordResult(game.guildId, { winnerId: winner.id, loserId: loser.id });
    }
  }
  return game;
}

export default {
  group: {
    name: 'connect4',
    aliases: ['c4'],
    description: 'Connect 4 on a panel — challenge an officer, or take on the bot.',
    emoji: '🔴',
    invokeWithoutSubcommand: true,
    fallback: 'play',
    subcommands: [
      {
        name: 'play',
        description: 'Open a Connect 4 panel. Name an officer, or leave it blank to face the bot.',
        args: [{ name: 'opponent', type: 'user' }],
        async run(ctx, { opponent = null }) {
          const availability = channelAvailability(ctx.channel.id);
          if (!availability.ok) {
            await ctx.reply(
              `🔴 A game is already running in this channel. It can be replaced after **${availability.minutesLeft} more minute${availability.minutesLeft === 1 ? '' : 's'}** of inactivity.`,
            );
            return;
          }

          if (opponent && opponent.id === ctx.user.id) {
            await ctx.reply('🔴 You cannot challenge yourself. Leave the name off to play the bot.');
            return;
          }
          if (opponent?.bot && opponent.id !== ctx.client.user.id) {
            await ctx.reply('🔴 That is another bot. Leave the name off to play me.');
            return;
          }

          const againstBot = !opponent || opponent.id === ctx.client.user.id;
          const me = { id: ctx.user.id, name: ctx.member?.displayName ?? ctx.user.username, bot: false };
          const them = againstBot
            ? { id: ctx.client.user.id, name: ctx.client.user.username, bot: true }
            : { id: opponent.id, name: opponent.displayName ?? opponent.username, bot: false };

          // The challenger is always RED (seat 0), which is also how the cog
          // seats a human against the bot.
          const game = createSession({
            channelId: ctx.channel.id,
            guildId: ctx.guild.id,
            players: [me, them],
            againstBot,
            state: newGame(),
          });

          // The starting player is random, so the bot may have to open.
          if (againstBot) botMoveIfDue(game);

          const message = await ctx.reply(payloadFor(game));
          game.messageId = message?.id ?? null;
        },
      },
      {
        name: 'stats',
        description: 'Your Connect 4 record, or someone else’s.',
        args: [{ name: 'member', type: 'user' }],
        async run(ctx, { member = null }) {
          const who = member ?? ctx.user;
          const all = getStats(ctx.guild.id);
          const p = playerStats(all, who.id);
          const total = p.wins + p.losses + p.ties;
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xdd2e44)
                .setTitle(`🔴 Connect 4 — ${member ? (who.displayName ?? who.username) : 'your record'}`)
                .setDescription(
                  total === 0
                    ? `No games yet. \`${ctx.prefix}connect4\` starts one.`
                    : [
                        `**Won:** ${p.wins} · **Lost:** ${p.losses} · **Tied:** ${p.ties}`,
                        `**Win rate:** ${Math.round((p.wins / total) * 100)}% over ${total} game${total === 1 ? '' : 's'}`,
                      ].join('\n'),
                ),
            ],
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'board',
        aliases: ['leaderboard', 'top'],
        description: 'The precinct’s Connect 4 leaderboard.',
        args: [],
        async run(ctx) {
          const rows = leaderboard(ctx.guild.id);
          await ctx.reply({
            embeds: [
              new EmbedBuilder()
                .setColor(0xdd2e44)
                .setTitle('🔴 Connect 4 — precinct leaderboard')
                .setDescription(
                  rows.length === 0
                    ? 'Nobody has finished a game yet.'
                    : rows
                        .map((r, i) => `**${i + 1}.** <@${r.id}> — ${r.wins}W / ${r.losses}L / ${r.ties}T`)
                        .join('\n'),
                ),
            ],
            allowedMentions: { parse: [] },
          });
        },
      },
      {
        name: 'end',
        description: 'End the game running in this channel.',
        args: [],
        async run(ctx) {
          const game = getGame(ctx.channel.id);
          if (!game || game.finished) {
            await ctx.reply('🔴 No game is running here.');
            return;
          }
          // Anyone may end a STALE game — the cog's rule, and the reason it
          // needs no timers. A live game may only be ended by its players.
          const stale = channelAvailability(ctx.channel.id).reason === 'stale';
          if (!stale && seatOf(game, ctx.user.id) < 0) {
            await ctx.reply('🔴 Only the players can end a game that is still being played.');
            return;
          }
          game.cancelled = true;
          game.finished = true;
          touch(game);
          await ctx.reply('🔴 Game ended.');
        },
      },
    ],
  },
};

export { RED };
