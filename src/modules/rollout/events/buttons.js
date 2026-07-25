// Rollout button pump (S81): the "ro:" customId prefix — lobby controls and
// the per-round number picks (cog-faithful quiet replies; the board restyles
// live as picks land, and the pending-mentions content shrinks).
import { Events, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { buildIo, lobbyComponents, lobbyEmbed, numberComponents } from '../commands/rollout.js';
import { MIN_PLAYERS } from '../lib/game.js';
import {
  endRolloutGame,
  getRolloutGame,
  joinRollout,
  leaveRollout,
  pickNumber,
  runRolloutGame,
} from '../service.js';
import { logger } from '../../../core/logger.js';

const quiet = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

const canManage = (interaction, game) =>
  interaction.user.id === game.hostId ||
  Boolean(interaction.memberPermissions?.has?.(PermissionFlagsBits.ManageGuild));

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const match = /^ro:(join|leave|players|start|cancel|pick):([^:]+)(?::(\d+))?$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, action, gameId, numberRaw] = match;

    const game = getRolloutGame(interaction.channelId);
    if (!game || game.id !== gameId) {
      await quiet(interaction, '⌛ That game is over — open a new lobby with `!rollout play`.');
      return;
    }

    if (action === 'pick') {
      const result = pickNumber(game, interaction.user.id, Number(numberRaw));
      if (result.code === 'not-player') return quiet(interaction, 'You are not in this game!');
      if (result.code === 'already') return quiet(interaction, 'You have already selected a number!');
      if (result.code === 'closed') return quiet(interaction, '⌛ This round is closed.');
      // Live board feedback + the shrinking pending list (cog behavior).
      const pending = game.roundPlayers.filter((id) => !(id in game.roundChoices));
      await interaction.deferUpdate().catch(() => {});
      await game.roundMessage
        ?.edit({
          content: pending.length ? pending.map((id) => `<@${id}>`).join(', ') : '​',
          components: numberComponents(game, [], { locked: false }),
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
      await interaction
        .followUp({ content: `You have selected the number ${numberRaw}!`, flags: MessageFlags.Ephemeral })
        .catch(() => {});
      return;
    }

    // Lobby-stage controls below.
    if (game.state !== 'lobby') {
      await quiet(interaction, 'ℹ️ The game already started.');
      return;
    }

    if (action === 'join') {
      const result = joinRollout(game, interaction.user.id);
      if (result === 'already') return quiet(interaction, 'You have already joined the game!');
      if (result === 'full') return quiet(interaction, "The game is full, you can't join!");
      await game.lobbyMessage?.edit({ embeds: [lobbyEmbed(game)], components: lobbyComponents(game) }).catch(() => {});
      return quiet(interaction, 'You have joined the game!');
    }
    if (action === 'leave') {
      const result = leaveRollout(game, interaction.user.id);
      if (result === 'not-joined') return quiet(interaction, 'You have not joined the game!');
      await game.lobbyMessage?.edit({ embeds: [lobbyEmbed(game)], components: lobbyComponents(game) }).catch(() => {});
      return quiet(interaction, 'You have left the game!');
    }
    if (action === 'players') {
      await interaction
        .reply({
          embeds: [
            {
              title: 'Rollout Game — Players',
              description: game.players.map((id) => `- <@${id}>`).join('\n'),
              color: 0x11806a,
            },
          ],
          flags: MessageFlags.Ephemeral,
        })
        .catch(() => {});
      return;
    }
    if (action === 'cancel') {
      if (!canManage(interaction, game)) return quiet(interaction, "You can't cancel the game!");
      endRolloutGame(game.channelId);
      await interaction.message.delete().catch(() => {});
      return;
    }

    // action === 'start'
    if (!canManage(interaction, game)) return quiet(interaction, "You can't start the game!");
    if (game.players.length < MIN_PLAYERS) {
      return quiet(interaction, 'You need at least 2 players to start the game!');
    }
    await interaction.deferUpdate().catch(() => {});
    await interaction.message.edit({ components: [] }).catch(() => {});
    runRolloutGame(game, buildIo(game, interaction.channel)).catch((error) =>
      logger.error('Rollout game crashed:', error),
    );
  },
};
