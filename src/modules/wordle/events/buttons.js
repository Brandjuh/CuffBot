// Wordle button pump (S83): the "wd:" customId prefix — the ephemeral
// Explanation (anyone may read it, cog behavior) and the ✖️ Cancel (player
// only; the cog's bot-owner backdoor dropped, as in S82).
import { EmbedBuilder, Events, MessageFlags } from 'discord.js';
import { EXPLANATION, finishCancel } from '../commands/wordle.js';
import { getWordleGame } from '../service.js';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const match = /^wd:(explain|cancel):([^:]+)$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, action, gameId] = match;

    if (action === 'explain') {
      await interaction
        .reply({
          embeds: [new EmbedBuilder().setColor(0x11806a).setTitle('Wordle Game - Explanation').setDescription(EXPLANATION)],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }

    // action === 'cancel'
    const game = getWordleGame(interaction.guild?.id, interaction.user.id);
    if (!game || game.id !== gameId) {
      await interaction
        .reply({ content: 'You are not allowed to use this interaction.', flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }
    await interaction.deferUpdate().catch(() => {});
    game.ended = true; // claim before the sends (S22)
    await finishCancel(game);
  },
};
