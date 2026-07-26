// Everything the mafia table SAYS (S105 = M24.1). Pure: takes a game state and
// a name lookup, returns embed data and component descriptors. Kept out of the
// command file so the wording is testable without a gateway — the same split
// that made the help menu (S98) and the goal tracker (S103) checkable.
import { PHASES, alivePlayers, playerOf } from './game.js';
import { ROLES } from './roles.js';
import { humanizeMs } from './config.js';

const NIGHT_COLOR = 0x2c3e8f;
const DAY_COLOR = 0xd4a017;
const TRIAL_COLOR = 0x9b3fb5;
const OVER_COLOR = 0x4a4a4a;
const LOBBY_COLOR = 0x2f6f9f;

/** Button ids are `mf:<action>:<gameId>[:<extra>]` — one prefix, one pump. */
export const buttonId = (action, gameId, extra) =>
  `mf:${action}:${gameId}${extra === undefined ? '' : `:${extra}`}`;

export function parseButtonId(customId) {
  const match = /^mf:([a-z]+):([^:]+)(?::(.+))?$/.exec(customId ?? '');
  if (!match) return null;
  return { action: match[1], gameId: match[2], extra: match[3] ?? null };
}

const mention = (id) => `<@${id}>`;

/** The lobby card: who is in, how many are needed, and what happens next. */
export function lobbyEmbed(game, { minPlayers, remainingMs }) {
  const need = Math.max(0, minPlayers - game.players.length);
  return {
    color: LOBBY_COLOR,
    title: '🕵️ A game of Mafia is forming',
    description: [
      'One of you answers to nobody. The rest of you have to work out who.',
      '',
      `**Players (${game.players.length}):**`,
      game.players.map((p) => `• ${mention(p.id)}${p.id === game.hostId ? ' 👑' : ''}`).join('\n'),
    ].join('\n'),
    footer: {
      text:
        need > 0
          ? `${need} more needed · the lobby closes in ${humanizeMs(remainingMs)}`
          : `Ready — the host can start · the lobby closes in ${humanizeMs(remainingMs)}`,
    },
  };
}

/** Night: says nothing about who is doing what, which is the point. */
export function nightEmbed(game, { remainingMs, waitingCount }) {
  return {
    color: NIGHT_COLOR,
    title: `🌙 Night ${game.day}`,
    description: [
      'The precinct goes dark. Somewhere, someone is deciding.',
      '',
      `**Still awake:** ${alivePlayers(game).length}`,
      waitingCount > 0
        ? `Waiting on **${waitingCount}** to act — press **Act** if that is you.`
        : 'Everyone has acted.',
    ].join('\n'),
    footer: { text: `Dawn in ${humanizeMs(remainingMs)}` },
  };
}

/** Morning: what the night did, named plainly. */
export function dayEmbed(game, events, { remainingMs, nameOf = mention }) {
  const killed = events.find((e) => e.type === 'killed');
  const saved = events.find((e) => e.type === 'saved');
  const lines = [];
  if (killed) {
    const role = ROLES[playerOf(game, killed.targetId)?.roleId];
    lines.push(`☠️ ${nameOf(killed.targetId)} did not make it through the night.`);
    if (role) lines.push(`They were **${role.emoji} ${role.name}**.`);
  } else if (saved) {
    // The town is told SOMEONE was saved, never who — the medic's value is
    // that the Boss does not know where the cover went.
    lines.push('🩺 There was an attack last night. Somebody walked away from it.');
  } else {
    lines.push('😐 A quiet night. Nobody so much as raised their voice.');
  }
  lines.push('', `**Still standing (${alivePlayers(game).length}):**`);
  lines.push(alivePlayers(game).map((p) => `• ${nameOf(p.id)}`).join('\n'));
  return {
    color: DAY_COLOR,
    title: `☀️ Day ${game.day}`,
    description: lines.join('\n'),
    footer: { text: `Discuss. Voting opens in ${humanizeMs(remainingMs)}` },
  };
}

/** The vote, with a live tally — Red-style visible pressure. */
export function votingEmbed(game, { remainingMs, nameOf = mention, tally = {} }) {
  const votedCount = Object.keys(game.votes).length;
  const rows = Object.entries(tally)
    .sort((a, b) => b[1] - a[1])
    .map(([id, count]) => `• ${nameOf(id)} — **${count}**`);
  return {
    color: DAY_COLOR,
    title: `🗳️ Day ${game.day} — the vote`,
    description: [
      'Pick who goes on trial. A tie puts **nobody** on trial.',
      '',
      rows.length > 0 ? rows.join('\n') : '*No votes cast yet.*',
      '',
      `${votedCount} of ${alivePlayers(game).length} have voted.`,
    ].join('\n'),
    footer: { text: `Voting closes in ${humanizeMs(remainingMs)}` },
  };
}

/** The trial. The accused does not get a vote and the card says so. */
export function judgementEmbed(game, { remainingMs, nameOf = mention }) {
  const counts = Object.values(game.judgement);
  return {
    color: TRIAL_COLOR,
    title: '⚖️ On trial',
    description: [
      `${nameOf(game.accusedId)} stands accused.`,
      '',
      `**Guilty:** ${counts.filter((v) => v === 'guilty').length} · **Innocent:** ${counts.filter((v) => v === 'innocent').length}`,
      '',
      'A tie acquits. The accused does not vote.',
    ].join('\n'),
    footer: { text: `Verdict in ${humanizeMs(remainingMs)}` },
  };
}

/** The reveal. Everyone is named, alive or not — that is the payoff. */
export function endEmbed(game, { nameOf = mention } = {}) {
  const fate = (p) =>
    p.alive ? 'survived' : p.diedTo === 'lynch' ? 'voted out' : 'killed at night';
  return {
    color: OVER_COLOR,
    title: game.winner === 'mafia' ? '🔫 The Boss wins' : '👮 The precinct wins',
    description:
      game.winner === 'mafia'
        ? 'The mafia can no longer be out-voted. This precinct belongs to somebody else now.'
        : 'Every crook is off the street. The paperwork will take weeks.',
    fields: [
      {
        name: 'Everyone’s cards',
        value: game.players
          .map((p) => {
            const role = ROLES[p.roleId];
            return `${role?.emoji ?? '❔'} ${nameOf(p.id)} — **${role?.name ?? 'unknown'}** (${fate(p)})`;
          })
          .join('\n'),
      },
    ],
  };
}

/** The role reference card, shown by `!mafia roles`. */
export function rolesEmbed() {
  return {
    color: LOBBY_COLOR,
    title: '🕵️ Mafia — the Classic cards',
    description: 'Five players or more. Exactly one of you is the Boss.',
    fields: Object.values(ROLES).map((role) => ({
      name: `${role.emoji} ${role.name} — ${role.side === 'mafia' ? 'Mafia' : 'Precinct'}`,
      value: `${role.description}\n**At night:** ${role.ability}`,
    })),
  };
}

/** What the buttons should be, given the phase. The pump renders them. */
export function componentsFor(game) {
  switch (game.phase) {
    case PHASES.LOBBY:
      return [
        { action: 'join', label: 'Join', style: 'primary', emoji: '✋' },
        { action: 'leave', label: 'Leave', style: 'secondary' },
        { action: 'begin', label: 'Start', style: 'success', emoji: '▶️' },
      ];
    case PHASES.NIGHT:
      return [{ action: 'act', label: 'Act', style: 'primary', emoji: '🌙' }];
    case PHASES.VOTING:
      return [{ action: 'vote', label: 'Vote', style: 'primary', emoji: '🗳️' }];
    case PHASES.JUDGEMENT:
      return [
        { action: 'guilty', label: 'Guilty', style: 'danger' },
        { action: 'innocent', label: 'Innocent', style: 'success' },
      ];
    default:
      return [];
  }
}

/** The private line an actor sees when they press **Act**. */
export function actionPromptFor(game, actorId) {
  const player = playerOf(game, actorId);
  if (!player) return { ok: false, text: 'You are not in this game.' };
  if (!player.alive) return { ok: false, text: 'The dead do not act. Enjoy the view.' };
  const role = ROLES[player.roleId];
  if (!role?.night) {
    return { ok: false, text: `You are **${role?.emoji ?? ''} ${role?.name ?? 'an Officer'}**. You sleep tonight.` };
  }
  if (game.actions[actorId] !== undefined) {
    return { ok: false, text: 'You have already acted tonight.' };
  }
  const verb = { kill: 'Who dies tonight?', protect: 'Who do you cover?', investigate: 'Who do you look into?' };
  return { ok: true, text: `**${role.emoji} ${role.name}** — ${verb[role.night]}`, role };
}

/** Who an actor may legally choose, given their role's rules. */
export function targetsFor(game, actorId) {
  const player = playerOf(game, actorId);
  const role = ROLES[player?.roleId];
  if (!role?.night) return [];
  return alivePlayers(game)
    .filter((p) => !(role.night === 'kill' && p.id === actorId))
    .filter((p) => !(role.night === 'protect' && player.lastProtected === p.id))
    .map((p) => p.id);
}
