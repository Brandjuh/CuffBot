// Crew-robbery lobby pump (S88 = M16.12 slice D): the "hst:" customId prefix.
// Joining is open to anyone who is not jailed, in debt or already on a job —
// the same gates the solo path checks, applied per presser.
import { Events, MessageFlags } from 'discord.js';
import { crewLobbyComponents, crewLobbyEmbed } from '../commands/heist.js';
import { armHeistTimer } from '../scheduler.js';
import {
  CREW_LOBBY_TIMEOUT_MS,
  CREW_SIZE,
  closeCrewLobby,
  getCrewLobby,
  getHeistSettings,
  getPlayer,
  jailStatus,
  joinCrewLobby,
  leaveCrewLobby,
  startCrewHeist,
} from '../service.js';

const quiet = (interaction, content) =>
  interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => {});

/** Can this officer be sent on a job right now? */
function unavailable(guildId, userId) {
  const player = getPlayer(guildId, userId);
  if (jailStatus(player).jailed) return 'You are in jail — pay bail first.';
  if (player.debt > 0) return 'You owe money — clear your debt first.';
  if (player.activeHeist) return 'You already have a job running.';
  return null;
}

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isButton?.()) return;
    const match = /^hst:(join|leave|begin|cancel):([^:]+)$/.exec(interaction.customId ?? '');
    if (!match) return;
    const [, action, lobbyId] = match;

    const lobby = getCrewLobby(interaction.channelId);
    if (!lobby || lobby.id !== lobbyId) {
      await quiet(interaction, '⌛ That crew has already moved out — start a new one with `!heist crew`.');
      return;
    }

    const heist = getHeistSettings(lobby.guildId, 'crew_robbery');
    const refresh = async () => {
      await interaction.deferUpdate().catch(() => {});
      await lobby.message
        ?.edit({
          embeds: [crewLobbyEmbed(lobby, heist, Date.now() + CREW_LOBBY_TIMEOUT_MS)],
          components: crewLobbyComponents(lobby),
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
    };

    if (action === 'join') {
      const blocker = unavailable(lobby.guildId, interaction.user.id);
      if (blocker) return quiet(interaction, `🚫 ${blocker}`);
      const result = joinCrewLobby(lobby, interaction.user.id);
      if (result === 'already') return quiet(interaction, "You've already joined this crew.");
      if (result === 'full') return quiet(interaction, 'The crew is already full.');
      await refresh();
      return quiet(interaction, 'You joined the crew.');
    }

    if (action === 'leave') {
      const result = leaveCrewLobby(lobby, interaction.user.id);
      if (result === 'organiser') return quiet(interaction, 'You organised this job — cancel it with ✖️ instead.');
      if (result === 'not-joined') return quiet(interaction, 'You are not in this crew.');
      await refresh();
      return quiet(interaction, 'You left the crew.');
    }

    if (action === 'cancel') {
      if (interaction.user.id !== lobby.hostId) return quiet(interaction, 'Only the organiser can call it off.');
      closeCrewLobby(lobby.channelId);
      await interaction.deferUpdate().catch(() => {});
      await lobby.message
        ?.edit({
          embeds: [crewLobbyEmbed(lobby, heist, Date.now()).setTitle('👥 Crew Robbery — called off')],
          components: crewLobbyComponents(lobby, { disabled: true }),
          allowedMentions: { parse: [] },
        })
        .catch(() => {});
      return;
    }

    // action === 'begin'
    if (interaction.user.id !== lobby.hostId) return quiet(interaction, 'Only the organiser can begin the heist.');
    if (lobby.members.length < CREW_SIZE) return quiet(interaction, `You need ${CREW_SIZE} officers to begin.`);
    // Someone may have been jailed or sent on a job while the lobby sat open.
    for (const userId of lobby.members) {
      const blocker = unavailable(lobby.guildId, userId);
      if (blocker) return quiet(interaction, `🚫 <@${userId}> can't go: ${blocker.toLowerCase()}`);
    }

    const members = [...lobby.members];
    closeCrewLobby(lobby.channelId);
    const { endsAt, leader } = startCrewHeist(lobby.guildId, members, interaction.channelId);
    // Only the leader's timer settles: one roll covers the whole crew.
    armHeistTimer(interaction.client, lobby.guildId, leader, endsAt);

    await interaction.deferUpdate().catch(() => {});
    await lobby.message
      ?.edit({
        embeds: [
          crewLobbyEmbed({ ...lobby, members }, heist, endsAt)
            .setTitle('👥 Crew Robbery — on the move')
            .setFooter({ text: 'The result lands when the clock runs out.' }),
        ],
        components: [],
        allowedMentions: { parse: [] },
      })
      .catch(() => {});
  },
};
