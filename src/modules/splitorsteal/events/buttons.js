// Split-or-steal button pump (S79): the "sos:" customId prefix — lobby joins
// and the two secret choices. Cog-faithful quiet replies (join confirmations
// and choices are ephemeral so a choice stays secret until both are in).
import { Events, MessageFlags } from 'discord.js';
import { chooseSos, getSosGame, joinSos } from '../service.js';

const quiet = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const match = /^sos:(join|split|steal):([^:]+)$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, action, gameId] = match;

    const game = getSosGame(interaction.channelId);
    if (!game || game.id !== gameId) {
      await quiet(interaction, '⌛ That match is over — start a new one with `!splitorsteal play`.');
      return;
    }

    if (action === 'join') {
      const result = joinSos(game, interaction.user.id);
      if (result === 'already') return quiet(interaction, 'You have already joined this game.');
      if (result === 'closed') return quiet(interaction, '⌛ The join window has closed.');
      return quiet(interaction, 'You have joined this game.');
    }

    // split / steal
    const result = chooseSos(game, interaction.user.id, action);
    if (result.code === 'not-player') return quiet(interaction, 'You are not allowed to use this interaction.');
    if (result.code === 'already') return quiet(interaction, `You have already chosen \`${result.original}\`.`);
    if (result.code === 'closed') return quiet(interaction, '⌛ The choosing window has closed.');
    return quiet(interaction, `You have chosen \`${action}\`.`);
  },
};
