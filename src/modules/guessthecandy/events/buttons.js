// Guess-the-candy button pump (S80): the "gtc:" customId prefix. Anyone may
// press (the cog has no player gate); wrong presses are the cog's quiet
// "Try again!"; the first correct press wins on the clock and the winner
// reply pings exactly them (cog behavior).
import { Events, MessageFlags } from 'discord.js';
import { formatElapsed } from '../lib/game.js';
import { candyComponents } from '../commands/guessthecandy.js';
import { endCandyGame, getCandyGame, pressCandy } from '../service.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const match = /^gtc:([^:]+):(\d+)$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, gameId, indexRaw] = match;

    const game = getCandyGame(gameId);
    if (!game) {
      await interaction
        .reply({ content: '⌛ That round is over — start a fresh one with `!gtc`.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    const guess = game.candies[Number(indexRaw)];
    const result = pressCandy(game, guess);
    if (result === 'wrong') {
      await interaction
        .reply({ content: 'You guessed wrong! Try again!', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }
    if (result === 'ended') {
      await interaction
        .reply({ content: '⌛ Too late — this round is already solved.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    // won — the ended flag flipped synchronously in pressCandy (no double win)
    const elapsed = formatElapsed(Date.now() - (game.startedAt ?? Date.now()));
    endCandyGame(game.id);
    await interaction.deferUpdate().catch(() => {});
    await game.message?.edit({ components: candyComponents(game, { disabled: true }) }).catch(() => {});
    await game.message
      ?.reply({
        content: `<@${interaction.user.id}>`,
        embeds: [
          {
            title: '🍬 Guess The Candy 🍬',
            description: `**Congratulations!** You've correctly guessed it's **${game.answer}**, in **${elapsed} seconds**!`,
            color: 0xe67e22,
          },
        ],
        allowedMentions: { users: [interaction.user.id] },
      })
      .catch(() => {});
  },
};
