// Connect 4 button presses (S71). Module-owned InteractionCreate handler
// filtering the "c4:" customId prefix (component pumps stay in text-only mode
// — buttons are not slash commands). Accept/decline drive the challenge; the
// column buttons play; forfeit ends it. The cog CRASHED on a full-column
// press — here it is a polite ephemeral refusal (recorded port fix).
import { Events, MessageFlags } from 'discord.js';
import { armMoveTimer, boardPayload, pieceFor } from '../commands/connect4.js';
import { dropMove, endGame, getGame, playerNumber, recordResult, startGame } from '../service.js';

const quiet = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const match = /^c4:(a|d|c|q):([^:]+)(?::(\d))?$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, action, gameId, colRaw] = match;

    const game = getGame(interaction.channelId);
    if (!game || game.id !== gameId) {
      await quiet(interaction, '⌛ That duel is over — start a fresh one with `!connect4 @officer`.');
      return;
    }

    // ── challenge stage ──────────────────────────────────────────────────────
    if (action === 'a' || action === 'd') {
      if (game.state !== 'pending') {
        await quiet(interaction, 'ℹ️ This duel already started.');
        return;
      }
      if (action === 'd') {
        // The challenged member declines — or the challenger withdraws.
        if (interaction.user.id === game.opponentId || interaction.user.id === game.challengerId) {
          const withdrew = interaction.user.id === game.challengerId;
          endGame(game.channelId);
          await interaction
            .update({
              embeds: interaction.message.embeds,
              components: [],
              content: withdrew
                ? `🏳️ <@${game.challengerId}> withdrew the challenge.`
                : `❌ <@${game.opponentId}> declined the duel.`,
              allowedMentions: { parse: [] },
            })
            .catch(() => {});
        } else {
          await quiet(interaction, '🚫 This challenge is not addressed to you.');
        }
        return;
      }
      if (interaction.user.id !== game.opponentId) {
        await quiet(interaction, '🚫 Only the challenged officer can accept.');
        return;
      }
      startGame(game);
      game.message = interaction.message;
      armMoveTimer(game);
      await interaction.update(boardPayload(game)).catch(() => {});
      return;
    }

    // ── playing stage ────────────────────────────────────────────────────────
    if (game.state !== 'playing') {
      await quiet(interaction, '⌛ The duel has not started yet.');
      return;
    }

    if (action === 'q') {
      const player = playerNumber(game, interaction.user.id);
      if (!player) {
        await quiet(interaction, '🚫 You are not in this duel.');
        return;
      }
      const winner = player === 1 ? 2 : 1;
      endGame(game.channelId);
      recordResult(game.guildId, {
        winnerId: winner === 1 ? game.challengerId : game.opponentId,
        loserId: player === 1 ? game.challengerId : game.opponentId,
      });
      await interaction
        .update(
          boardPayload(game, {
            finished: `🏳️ ${pieceFor(player)} <@${interaction.user.id}> forfeits — ${pieceFor(winner)} <@${winner === 1 ? game.challengerId : game.opponentId}> wins.`,
          }),
        )
        .catch(() => {});
      return;
    }

    // action === 'c' — a column press
    const result = dropMove(game, interaction.user.id, Number(colRaw));
    if (result.code === 'not-player') {
      await quiet(interaction, '🚫 You are not in this duel — challenge someone with `!connect4 @officer`.');
      return;
    }
    if (result.code === 'not-your-turn') {
      await quiet(interaction, '⏳ Not your move — wait for your opponent.');
      return;
    }
    if (result.code === 'full-column') {
      await quiet(interaction, '🚫 That column is full — pick another one.');
      return;
    }

    if (result.code === 'win') {
      const winnerId = interaction.user.id;
      const loserId = winnerId === game.challengerId ? game.opponentId : game.challengerId;
      const piece = pieceFor(playerNumber(game, winnerId));
      endGame(game.channelId);
      recordResult(game.guildId, { winnerId, loserId });
      await interaction
        .update(boardPayload(game, { finished: `🏆 ${piece} <@${winnerId}> connects four — case closed!` }))
        .catch(() => {});
      return;
    }
    if (result.code === 'tie') {
      endGame(game.channelId);
      recordResult(game.guildId, { tie: [game.challengerId, game.opponentId] });
      await interaction
        .update(boardPayload(game, { finished: '🤝 The board is full — it’s a tie.' }))
        .catch(() => {});
      return;
    }

    // next move
    game.message = interaction.message;
    armMoveTimer(game);
    await interaction.update(boardPayload(game)).catch(() => {});
  },
};
