// Button presses for trivia rounds. A module-owned InteractionCreate handler
// (the core slash router only handles chat-input commands), filtering on the
// "trivia:" customId prefix so it never touches other components.
import { Events, MessageFlags } from 'discord.js';
import { applyAnswer } from '../lib/game.js';
import { addPoint, getRound } from '../service.js';
import { revealRound } from '../commands/trivia.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const match = /^trivia:(.+):(\d+)$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, roundId, choiceRaw] = match;

    const round = getRound(interaction.channelId);
    if (!round || round.roundId !== roundId) {
      await interaction
        .reply({ content: '⌛ That round is over — start a fresh one with `/trivia`.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    const result = applyAnswer(round, interaction.user.id, Number(choiceRaw));
    if (result === 'winner') {
      const total = addPoint(interaction.guildId, interaction.user.id);
      // Acknowledge the press before editing the message, so Discord never
      // shows "interaction failed" to the winner.
      await interaction
        .reply({ content: `🎉 Correct! That's **${total}** point${total === 1 ? '' : 's'} on your record.`, flags: MessageFlags.Ephemeral })
        .catch(() => {});
      await revealRound(interaction.channelId);
    } else if (result === 'wrong') {
      await interaction
        .reply({ content: '🚫 Wrong answer, officer — one guess per round. Better luck next case.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    } else if (result === 'already-answered') {
      await interaction
        .reply({ content: '🚫 You already used your one guess this round.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    } else {
      await interaction
        .reply({ content: '⌛ Too late — this case is already closed.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
    }
  },
};
