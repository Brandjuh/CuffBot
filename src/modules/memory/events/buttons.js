// Memory button pump (S82): the "mem:" customId prefix. The state machine
// lives in service.pressTile; this file only renders. Presses landing during
// the 1 s mismatch flash are ignored (the cog queued them behind an asyncio
// lock — recorded deviation, prevents interleaved edits).
import { Events, MessageFlags } from 'discord.js';
import { armIdle, boardComponents, loseEmbed, winEmbed } from '../commands/memory.js';
import { MISMATCH_FLASH_MS } from '../lib/game.js';
import { endMemoryGame, finishWin, getMemoryGame, pressTile, unlockMemoryGame } from '../service.js';

const quiet = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

const sleep = (ms) =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const match = /^mem:pick:([^:]+):(\d+)$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, gameId, indexRaw] = match;

    const game = getMemoryGame(gameId);
    if (!game) {
      await quiet(interaction, '⌛ That game is over — start a new one with `!memory play`.');
      return;
    }
    if (interaction.user.id !== game.playerId) {
      await quiet(interaction, 'You are not allowed to use this interaction.');
      return;
    }

    const result = pressTile(game, Number(indexRaw));
    await interaction.deferUpdate().catch(() => {});
    if (result.code === 'ended' || result.code === 'busy' || result.code === 'ignored') return;
    armIdle(game);
    const author = {
      name: interaction.member?.displayName ?? interaction.user.username,
      iconURL: interaction.user.displayAvatarURL(),
    };

    if (result.code === 'selected' || result.code === 'match') {
      await game.message?.edit({ components: boardComponents(game) }).catch(() => {});
      return;
    }

    if (result.code === 'won') {
      const settled = await finishWin(game);
      endMemoryGame(game.id);
      await game.message
        ?.edit({
          embeds: [winEmbed(settled, author)],
          components: boardComponents(game, { revealAll: true, disableAll: true }),
        })
        .catch(() => {});
      return;
    }

    // mismatch / lost: flash the bad pair red for a second (cog behavior)…
    await game.message
      ?.edit({ components: boardComponents(game, { flash: { first: result.first, second: result.second } }) })
      .catch(() => {});
    await sleep(MISMATCH_FLASH_MS);

    if (result.code === 'lost') {
      endMemoryGame(game.id);
      await game.message
        ?.edit({ embeds: [loseEmbed(game, author)], components: boardComponents(game, { disableAll: true }) })
        .catch(() => {});
      return;
    }

    // …then hide it again and accept presses once more.
    await game.message?.edit({ components: boardComponents(game) }).catch(() => {});
    unlockMemoryGame(game);
  },
};
