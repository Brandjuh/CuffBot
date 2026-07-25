// Russian-roulette button pump (S73): lobby joins/leaves/list/start/cancel and
// the per-turn Shoot press, filtering the "rr:" customId prefix. Cog-faithful
// ephemeral texts; start/cancel allowed for the host or Manage Server.
import { EmbedBuilder, Events, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { buildIo, lobbyComponents, lobbyEmbed } from '../commands/russianroulette.js';
import { MIN_PLAYERS } from '../lib/game.js';
import {
  endRouletteGame,
  getRouletteGame,
  joinLobby,
  leaveLobby,
  resolveShot,
  runGame,
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
    const match = /^rr:(join|leave|players|start|cancel|shoot):([^:]+)$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, action, gameId] = match;

    const game = getRouletteGame(interaction.channelId);
    if (!game || game.id !== gameId) {
      await quiet(interaction, '⌛ That game is over — a mod can open a new lobby with `!russianroulette play`.');
      return;
    }

    if (action === 'shoot') {
      if (game.state !== 'running' || !resolveShot(game, interaction.user.id)) {
        await quiet(interaction, "You can't shoot for someone else!");
        return;
      }
      await interaction.deferUpdate().catch(() => {});
      return;
    }

    // Everything below is lobby-stage only.
    if (game.state !== 'lobby') {
      await quiet(interaction, 'ℹ️ The game already started.');
      return;
    }

    if (action === 'join') {
      const result = joinLobby(game, interaction.user.id);
      if (result === 'already') return quiet(interaction, 'You have already joined the game!');
      if (result === 'full') return quiet(interaction, "The game is full, you can't join!");
      await game.lobbyMessage?.edit({ embeds: [lobbyEmbed(game)], components: lobbyComponents(game) }).catch(() => {});
      return quiet(interaction, 'You have joined the game!');
    }

    if (action === 'leave') {
      const result = leaveLobby(game, interaction.user.id);
      if (result === 'not-joined') return quiet(interaction, 'You have not joined the game!');
      await game.lobbyMessage?.edit({ embeds: [lobbyEmbed(game)], components: lobbyComponents(game) }).catch(() => {});
      return quiet(interaction, 'You have left the game!');
    }

    if (action === 'players') {
      const embed = new EmbedBuilder()
        .setColor(0x992d22)
        .setTitle('Russian Roulette Game — Players')
        .setDescription(game.players.map((id) => `- <@${id}>`).join('\n'));
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
      return;
    }

    if (action === 'cancel') {
      if (!canManage(interaction, game)) return quiet(interaction, "You can't cancel the game!");
      endRouletteGame(game.channelId);
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
    // The runner owns the game from here; it cleans up in its finally block.
    runGame(game, buildIo(game, interaction.channel)).catch((error) =>
      logger.error('Russian roulette game crashed:', error),
    );
  },
};
