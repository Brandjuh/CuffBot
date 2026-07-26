// The panel's button pump (M26.2a). Module-owned `InteractionCreate` filtered
// on the `mg:` prefix, the same shape every other component-driven module uses.
//
// The S98 non-originator rule applies with a twist worth naming: the panel is a
// public message with TWO legitimate pressers, not one. So "is this your
// message?" is the wrong question — the right one is "is it your turn?", and
// everyone else gets a private answer rather than a silent failure.
import { Events, MessageFlags } from 'discord.js';
import { NONE, availableColumns, newGame, playColumn } from '../lib/connect4.js';
import { botMoveIfDue, payloadFor, settleIfOver } from '../commands/minigames.js';
import { createSession, getGame, seatOf, touch } from '../service.js';

const quiet = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const match = /^mg:([^:]+):(accept|decline|rematch|col:(\d))$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, gameId, action, columnRaw] = match;

    const game = getGame(interaction.channelId);
    if (!game || game.id !== gameId) {
      await quiet(interaction, '⌛ That game is over. Start a fresh one with `!connect4`.');
      return;
    }

    const seat = seatOf(game, interaction.user.id);

    // ── the invitation ───────────────────────────────────────────────────────
    if (action === 'accept' || action === 'decline') {
      if (game.accepted) {
        await quiet(interaction, 'ℹ️ This game already started.');
        return;
      }
      if (seat !== 1) {
        await quiet(interaction, '🔴 Only the challenged officer can answer this invitation.');
        return;
      }
      if (action === 'decline') {
        game.cancelled = true;
        game.finished = true;
        await interaction.update({ content: '🔴 Invitation declined.', embeds: [], components: [] }).catch(() => {});
        return;
      }
      game.accepted = true;
      touch(game);
      botMoveIfDue(game);
      await interaction.update(payloadFor(game)).catch(() => {});
      return;
    }

    // ── a rematch ────────────────────────────────────────────────────────────
    if (action === 'rematch') {
      if (seat < 0) {
        await quiet(interaction, '🔴 Only the two players can start a rematch.');
        return;
      }
      // Seats swap, so whoever was blue opens as red — the fair way to run a
      // second game, and it costs nothing to do here.
      const next = createSession({
        channelId: game.channelId,
        guildId: game.guildId,
        players: [game.players[1], game.players[0]],
        againstBot: game.againstBot,
        state: newGame(),
      });
      if (next.againstBot) botMoveIfDue(next);
      const message = await interaction.update(payloadFor(next)).catch(() => null);
      next.messageId = message?.id ?? game.messageId;
      return;
    }

    // ── a move ───────────────────────────────────────────────────────────────
    if (!game.accepted) {
      await quiet(interaction, '🔴 The invitation has not been accepted yet.');
      return;
    }
    if (game.finished || game.state.winner !== NONE) {
      await quiet(interaction, 'ℹ️ This game is finished.');
      return;
    }
    if (seat < 0) {
      await quiet(interaction, '🔴 You are not in this game. Start your own with `!connect4`.');
      return;
    }
    if (seat !== game.state.current) {
      await quiet(interaction, '⏳ Not your turn.');
      return;
    }

    const column = Number(columnRaw);
    // The buttons for full columns are disabled, so this can only be reached
    // by a stale client — a refusal rather than the crash the cog had.
    if (!availableColumns(game.state.board).includes(column)) {
      await quiet(interaction, '🔴 That column is full.');
      return;
    }

    game.state = playColumn(game.state, column);
    touch(game);
    settleIfOver(game); // the human may have just won — settle before the bot replies
    botMoveIfDue(game);
    await interaction.update(payloadFor(game)).catch(() => {});
  },
};
