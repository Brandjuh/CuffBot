// The !connect4 group (S71 = M16.3, phen-cogs port): `!connect4 @officer`
// opens a challenge (fallback sub — no subcommand word needed), buttons play
// the 7×6 duel, `!connect4 stats` shows the precinct scoreboard.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { renderBoard } from '../lib/board.js';
import {
  CHALLENGE_TIMEOUT_MS,
  MOVE_TIMEOUT_MS,
  armTimer,
  createChallenge,
  endGame,
  getGame,
  getStats,
  recordResult,
  topPlayers,
} from '../service.js';

const RED = 0xe74c3c;

export const pieceFor = (player) => (player === 1 ? '🔴' : '🔵');

const nameOf = (game, player) => `<@${player === 1 ? game.challengerId : game.opponentId}>`;

/** The live board embed + the 7 column buttons and the forfeit flag. */
export function boardPayload(game, { finished = null } = {}) {
  const statusLine = finished ?? `On the move: ${pieceFor(game.turn)} ${nameOf(game, game.turn)}`;
  const embed = new EmbedBuilder()
    .setColor(RED)
    .setTitle(`🔴 Connect 4 — duel in progress`)
    .setDescription(
      [
        `${pieceFor(1)} ${nameOf(game, 1)} vs ${pieceFor(2)} ${nameOf(game, 2)}`,
        '',
        renderBoard(game.board),
        '',
        statusLine,
      ].join('\n'),
    );
  if (finished) return { embeds: [embed], components: [], allowedMentions: { parse: [] } };
  const buttons = Array.from({ length: 7 }, (_, i) =>
    new ButtonBuilder()
      .setCustomId(`c4:c:${game.id}:${i}`)
      .setLabel(String(i + 1))
      .setStyle(ButtonStyle.Secondary),
  );
  const rows = [
    new ActionRowBuilder().addComponents(buttons.slice(0, 4)),
    new ActionRowBuilder().addComponents(
      ...buttons.slice(4),
      new ButtonBuilder().setCustomId(`c4:q:${game.id}`).setLabel('Forfeit 🏳️').setStyle(ButtonStyle.Danger),
    ),
  ];
  return { embeds: [embed], components: rows, allowedMentions: { parse: [] } };
}

/** Arm the 120 s inactivity forfeit: the player on turn loses. */
export function armMoveTimer(game, { timeoutMs = MOVE_TIMEOUT_MS } = {}) {
  armTimer(game, timeoutMs, async () => {
    const loser = game.turn;
    const winner = loser === 1 ? 2 : 1;
    endGame(game.channelId);
    recordResult(game.guildId, {
      winnerId: winner === 1 ? game.challengerId : game.opponentId,
      loserId: loser === 1 ? game.challengerId : game.opponentId,
    });
    await game.message
      ?.edit(
        boardPayload(game, {
          finished: `⏰ ${pieceFor(loser)} ${nameOf(game, loser)} took too long (2 min) — ${pieceFor(winner)} ${nameOf(game, winner)} wins by forfeit.`,
        }),
      )
      .catch(() => {});
  });
}

export default {
  group: {
    name: 'connect4',
    aliases: ['c4'],
    description: 'Connect 4: challenge an officer to a 7×6 button duel.',
    emoji: '🔴',
    fallback: 'play',
    status(ctx) {
      const stats = getStats(ctx.guild.id);
      const open = getGame(ctx.channel.id);
      return [
        `Challenge someone with \`${ctx.prefix}connect4 @officer\` — they get 60 s to accept, then you drop pieces with the column buttons. Four in a row wins; 2 minutes of silence forfeits.`,
        '',
        `**Played here:** ${stats.played} game${stats.played === 1 ? '' : 's'} (${stats.ties} tie${stats.ties === 1 ? '' : 's'})`,
        open
          ? `**This channel:** a ${open.state === 'pending' ? 'challenge is waiting' : 'duel is in progress'} — one game per channel.`
          : '**This channel:** free — the floor is yours.',
      ];
    },
    subcommands: [
      {
        name: 'play',
        aliases: ['challenge'],
        description: 'Challenge a member to a duel.',
        args: [{ name: 'opponent', type: 'user', required: true }],
        async run(ctx, { opponent }) {
          if (opponent.bot) {
            await ctx.reply('🚫 K9 units don’t play board games. Challenge a human officer.');
            return;
          }
          if (opponent.id === ctx.user.id) {
            await ctx.reply('🚫 You can’t duel yourself — that’s just solitaire with extra steps.');
            return;
          }
          const result = createChallenge(ctx.channel.id, ctx.guild.id, ctx.user.id, opponent.id);
          if (result.error === 'busy') {
            await ctx.reply('🚫 There’s already a game (or open challenge) in this channel — one duel at a time.');
            return;
          }
          const game = result.game;
          const embed = new EmbedBuilder()
            .setColor(RED)
            .setTitle('🔴 Connect 4 — challenge!')
            .setDescription(
              `<@${ctx.user.id}> challenges <@${opponent.id}> to a duel.\n${pieceFor(1)} challenger · ${pieceFor(2)} challenged\n\nYou have **60 seconds** to accept.`,
            );
          const buttons = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`c4:a:${game.id}`).setLabel('Accept ✅').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`c4:d:${game.id}`).setLabel('Decline ❌').setStyle(ButtonStyle.Danger),
          );
          // The challenge deliberately pings exactly the challenged member.
          const message = await ctx.reply({
            embeds: [embed],
            components: [buttons],
            allowedMentions: { users: [opponent.id], repliedUser: false },
          });
          if (!message) {
            endGame(ctx.channel.id);
            return;
          }
          game.message = message;
          armTimer(game, CHALLENGE_TIMEOUT_MS, async () => {
            endGame(game.channelId);
            await game.message
              ?.edit({
                embeds: [
                  EmbedBuilder.from(embed).setDescription(
                    `<@${game.opponentId}> never showed up — challenge expired.`,
                  ),
                ],
                components: [],
                allowedMentions: { parse: [] },
              })
              .catch(() => {});
          });
        },
      },
      {
        name: 'stats',
        description: 'The precinct Connect 4 scoreboard.',
        args: [],
        async run(ctx) {
          const stats = getStats(ctx.guild.id);
          const top = topPlayers(ctx.guild.id);
          const medals = ['🥇', '🥈', '🥉'];
          const lines = top.length
            ? top.map((p, i) => `${medals[i]} <@${p.id}> — **${p.wins}** win${p.wins === 1 ? '' : 's'}, ${p.losses} loss${p.losses === 1 ? '' : 'es'}, ${p.ties} tie${p.ties === 1 ? '' : 's'}`)
            : ['_Nobody has played yet — be the first!_'];
          const mine = stats.players[ctx.user.id];
          const embed = new EmbedBuilder()
            .setColor(RED)
            .setTitle('🔴 Connect 4 — precinct scoreboard')
            .setDescription(
              [
                `**Games played:** ${stats.played} · **ties:** ${stats.ties}`,
                '',
                ...lines,
                ...(mine ? ['', `**Your record:** ${mine.wins}W / ${mine.losses}L / ${mine.ties}T`] : []),
              ].join('\n'),
            );
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
    ],
  },
};
