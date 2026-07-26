// The panel's button pump (M26.2a, extended for Tic-Tac-Toe + staking in
// M26.2b). Module-owned `InteractionCreate` filtered on the `mg:` prefix, the
// same shape every other component-driven module uses.
//
// The S98 non-originator rule applies with a twist worth naming: the panel is a
// public message with TWO legitimate pressers, not one. So "is this your
// message?" is the wrong question — the right one is "is it your turn?", and
// everyone else gets a private answer rather than a silent failure.
import { Events, MessageFlags } from 'discord.js';
import { newGame as newConnect4 } from '../lib/connect4.js';
import { newGame as newTicTacToe } from '../lib/tictactoe.js';
import {
  botMoveIfDue,
  payloadFor,
  refundStakes,
  rulesFor,
  settleIfOver,
  stakeFor,
  takeStakes,
} from '../runtime.js';
import { createSession, getGame, seatOf, touch } from '../service.js';

const NEW_STATE = { connect4: newConnect4, tictactoe: newTicTacToe };

const money = (n) => Number(n).toLocaleString('en-US');

const quiet = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const match = /^mg:([^:]+):(accept|decline|rematch|col:\d+|slot:\d+)$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, gameId, action] = match;

    const game = getGame(interaction.channelId);
    if (!game || game.id !== gameId) {
      await quiet(interaction, '⌛ That game is over. Start a fresh one with `!connect4` or `!tictactoe`.');
      return;
    }

    const rules = rulesFor(game);
    const seat = seatOf(game, interaction.user.id);

    // ── the invitation ───────────────────────────────────────────────────────
    if (action === 'accept' || action === 'decline') {
      if (game.accepted) {
        await quiet(interaction, 'ℹ️ This game already started.');
        return;
      }
      if (seat !== 1) {
        await quiet(interaction, `${rules.label === 'Connect 4' ? '🔴' : '❌'} Only the challenged officer can answer this invitation.`);
        return;
      }
      if (action === 'decline') {
        game.cancelled = true;
        game.finished = true;
        // Nothing was staked yet — stakes are taken on accept, precisely so a
        // declined invitation costs nobody anything. `refundStakes` is still
        // called because a future path might accept then decline, and a
        // no-op refund is cheaper than a missed one.
        await refundStakes(game);
        await interaction.update({ content: '🚫 Invitation declined.', embeds: [], components: [] }).catch(() => {});
        return;
      }

      // Money moves here, before the board does: if the challenged officer
      // cannot cover the buy-in the game must not start, and the panel must
      // stay on the invitation rather than showing a board nobody paid for.
      const taken = await takeStakes(game);
      if (!taken.ok) {
        await quiet(
          interaction,
          `💰 The buy-in is **${money(taken.need)} 🍩** and ${
            taken.shortId === interaction.user.id ? `you have **${money(taken.have)}**` : 'your opponent cannot cover it'
          }.`,
        );
        return;
      }

      game.accepted = true;
      touch(game);
      await botMoveIfDue(game);
      await interaction.update(payloadFor(game)).catch(() => {});
      return;
    }

    // ── a rematch ────────────────────────────────────────────────────────────
    if (action === 'rematch') {
      if (seat < 0) {
        await quiet(interaction, '🎮 Only the two players can start a rematch.');
        return;
      }
      // Seats swap, so whoever went second opens — the fair way to run a
      // second game, and it costs nothing to do here.
      const next = createSession({
        channelId: game.channelId,
        guildId: game.guildId,
        players: [game.players[1], game.players[0]],
        againstBot: game.againstBot,
        game: game.game,
        state: NEW_STATE[game.game ?? 'connect4'](),
        // A rematch is a NEW game at the CURRENT settings, with its own prize
        // draw. Carrying the old stake over would keep charging yesterday's
        // buy-in after an admin changed it.
        stake: stakeFor(game.guildId, { againstBot: game.againstBot }),
      });
      // A rematch against the bot is accepted on creation, so it owes its
      // stake immediately — the same rule the opener follows.
      if (next.againstBot) {
        const taken = await takeStakes(next);
        if (!taken.ok) {
          next.finished = true;
          next.cancelled = true;
          await quiet(interaction, `💰 The buy-in is **${money(taken.need)} 🍩** and you have **${money(taken.have)}**.`);
          return;
        }
        await botMoveIfDue(next);
      }
      const message = await interaction.update(payloadFor(next)).catch(() => null);
      next.messageId = message?.id ?? game.messageId;
      return;
    }

    // ── a move ───────────────────────────────────────────────────────────────
    if (!game.accepted) {
      await quiet(interaction, '⏳ The invitation has not been accepted yet.');
      return;
    }
    if (game.finished || game.state.winner !== rules.none) {
      await quiet(interaction, 'ℹ️ This game is finished.');
      return;
    }
    if (seat < 0) {
      await quiet(interaction, '🎮 You are not in this game. Start your own with `!connect4` or `!tictactoe`.');
      return;
    }
    if (seat !== game.state.current) {
      await quiet(interaction, '⏳ Not your turn.');
      return;
    }

    const move = rules.moveFromAction(action);
    if (move === null || Number.isNaN(move)) {
      // A `slot:` press on a Connect 4 board, or the reverse — only reachable
      // from a stale client holding a panel the channel has moved past.
      await quiet(interaction, '🎮 That button belongs to a different game.');
      return;
    }

    // The buttons for taken cells are disabled, so this can only be reached by
    // a stale client — a refusal rather than the crash the cog had.
    try {
      game.state = rules.play(game.state, move);
    } catch {
      await quiet(interaction, '🎮 That square is already taken.');
      return;
    }

    touch(game);
    await settleIfOver(game); // the human may have just won — settle before the bot replies
    await botMoveIfDue(game);
    await interaction.update(payloadFor(game)).catch(() => {});
  },
};
