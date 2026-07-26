// The mafia table's Discord side (S105 = M24.1): posting the phase card,
// advancing the phases, arming the deadlines. Every RULE it applies comes from
// lib/; what is left here is the part that cannot exist without a gateway.
//
// One message per table, edited in place — the published-post shape (S97),
// scoped to a single message because a game is transient.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { logger } from '../../core/logger.js';
import { phaseLengthOf } from './lib/config.js';
import {
  PHASES,
  alivePlayers,
  closeJudgement,
  closeVoting,
  openVoting,
  pendingActors,
  resolveNight,
  voteTally,
} from './lib/game.js';
import { ROLES } from './lib/roles.js';
import {
  buttonId,
  componentsFor,
  dayEmbed,
  endEmbed,
  judgementEmbed,
  lobbyEmbed,
  nightEmbed,
  votingEmbed,
} from './lib/render.js';
import { MIN_PLAYERS } from './lib/roles.js';
import { armPhaseTimer, clearTable, getMafiaConfig, recordResult, setTable, tableIn } from './service.js';

const STYLES = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

/** A display-name lookup that degrades to a mention rather than throwing. */
export function namerFor(guild) {
  return (id) => guild?.members?.cache?.get(id)?.displayName ?? `<@${id}>`;
}

function rowsFor(game) {
  const buttons = componentsFor(game);
  if (buttons.length === 0) return [];
  return [
    new ActionRowBuilder().addComponents(
      buttons.map((b) => {
        const button = new ButtonBuilder()
          .setCustomId(buttonId(b.action, game.id))
          .setLabel(b.label)
          .setStyle(STYLES[b.style] ?? ButtonStyle.Secondary);
        if (b.emoji) button.setEmoji(b.emoji);
        return button;
      }),
    ),
  ];
}

/** The card for whatever phase the game is in. */
export function payloadFor(game, { guild, events = [], remainingMs = 0 }) {
  const nameOf = namerFor(guild);
  let embed;
  switch (game.phase) {
    case PHASES.LOBBY:
      embed = lobbyEmbed(game, { minPlayers: MIN_PLAYERS, remainingMs });
      break;
    case PHASES.NIGHT:
      embed = nightEmbed(game, { remainingMs, waitingCount: pendingActors(game).length });
      break;
    case PHASES.DAY:
      embed = dayEmbed(game, events, { remainingMs, nameOf });
      break;
    case PHASES.VOTING:
      embed = votingEmbed(game, { remainingMs, nameOf, tally: voteTally(game) });
      break;
    case PHASES.JUDGEMENT:
      embed = judgementEmbed(game, { remainingMs, nameOf });
      break;
    default:
      embed = endEmbed(game, { nameOf });
  }
  return {
    embeds: [new EmbedBuilder(embed)],
    components: rowsFor(game),
    allowedMentions: { parse: [] },
  };
}

/** Post or edit the one message this table owns. */
export async function render(channel, game, { events = [], remainingMs = 0 } = {}) {
  const table = tableIn(channel.id);
  const payload = payloadFor(game, { guild: channel.guild, events, remainingMs });
  if (table?.messageId) {
    const existing = await channel.messages.fetch(table.messageId).catch(() => null);
    if (existing) {
      await existing.edit(payload).catch(() => null);
      return existing;
    }
  }
  // Deleted by hand, or the first card: post a fresh one and track it.
  const sent = await channel.send(payload).catch(() => null);
  if (sent) setTable(channel.id, { messageId: sent.id });
  return sent;
}

/**
 * Move the table into `game`'s current phase: store it, draw it, arm the
 * deadline. Every path that changes a game ends here, so there is exactly one
 * place that decides what a phase looks like and how long it lasts.
 */
export async function enterPhase(channel, game, { events = [], io = {} } = {}) {
  setTable(channel.id, { game });
  const config = getMafiaConfig(channel.guild.id);
  const ms = phaseLengthOf(game.phase, config);

  if (game.phase === PHASES.OVER) {
    await render(channel, game, { events });
    try {
      recordResult(channel.guild.id, game);
    } catch (error) {
      logger.warn('Mafia: could not record the result:', error);
    }
    clearTable(channel.id);
    return;
  }

  await render(channel, game, { events, remainingMs: ms ?? 0 });
  if (ms) {
    armPhaseTimer(channel.id, ms, () => advance(channel, { reason: 'timeout' }), io);
  }
}

/**
 * Close the current phase and open the next one. Called by the deadline and by
 * the pump the moment a phase is unanimously complete — a table should never
 * sit waiting on a clock everyone has already beaten.
 */
export async function advance(channel, { reason = 'complete', io = {} } = {}) {
  const table = tableIn(channel.id);
  if (!table?.game) return;
  const game = table.game;

  switch (game.phase) {
    case PHASES.LOBBY: {
      // The lobby only ever ends by timeout; starting is the host's button.
      await channel
        .send({ content: '🕵️ Nobody started the game in time. The table is closed.' })
        .catch(() => null);
      clearTable(channel.id);
      return;
    }
    case PHASES.NIGHT: {
      const { game: next, events } = resolveNight(game);
      await deliverPrivate(channel, events);
      await enterPhase(channel, next, { events, io });
      return;
    }
    case PHASES.DAY: {
      const opened = openVoting(game);
      if (!opened.ok) return;
      await enterPhase(channel, opened.game, { io });
      return;
    }
    case PHASES.VOTING: {
      const closed = closeVoting(game);
      if (closed.accusedId === null) {
        await channel
          .send({
            content:
              reason === 'timeout'
                ? '🗳️ The vote was split. Nobody stands trial today.'
                : '🗳️ No majority. Nobody stands trial today.',
            allowedMentions: { parse: [] },
          })
          .catch(() => null);
      }
      await enterPhase(channel, closed.game, { io });
      return;
    }
    case PHASES.JUDGEMENT: {
      const verdict = closeJudgement(game);
      const nameOf = namerFor(channel.guild);
      const role = ROLES[game.players.find((p) => p.id === game.accusedId)?.roleId];
      await channel
        .send({
          content: verdict.guilty
            ? `⚖️ Guilty. ${nameOf(game.accusedId)} is taken away — they were **${role?.emoji ?? ''} ${role?.name ?? 'unknown'}**.`
            : `⚖️ Not guilty. ${nameOf(game.accusedId)} walks free.`,
          allowedMentions: { parse: [] },
        })
        .catch(() => null);
      await enterPhase(channel, verdict.game, { io });
      return;
    }
    default:
  }
}

/**
 * The detective's result. It is the only private outcome of a night, and it
 * goes by DM because it must not be visible to the room — the S54 no-DM rule
 * is about `!command` REPLIES, not about a game secret nobody asked to be
 * shouted.
 */
async function deliverPrivate(channel, events) {
  const nameOf = namerFor(channel.guild);
  for (const event of events) {
    if (event.type !== 'investigation') continue;
    const member = await channel.guild.members.fetch(event.to).catch(() => null);
    if (!member) continue;
    // eslint-disable-next-line no-await-in-loop -- at most one per night
    await member
      .send(
        event.mafia
          ? `🕵️ Your investigation: **${nameOf(event.targetId)} is with the mafia.**`
          : `🕵️ Your investigation: **${nameOf(event.targetId)} is clean.**`,
      )
      .catch(() =>
        channel
          .send({
            content: `🕵️ <@${event.to}>, I could not DM your result — open your DMs before the next night.`,
            allowedMentions: { users: [event.to] },
          })
          .catch(() => null),
      );
  }
}

/** Has everyone who can act, acted? Then do not wait for the clock. */
export const nightComplete = (game) => pendingActors(game).length === 0;
export const votingComplete = (game) =>
  alivePlayers(game).every((p) => game.votes[p.id] !== undefined);
export const judgementComplete = (game) =>
  alivePlayers(game)
    .filter((p) => p.id !== game.accusedId)
    .every((p) => game.judgement[p.id] !== undefined);
