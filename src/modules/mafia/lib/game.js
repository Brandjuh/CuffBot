// The Classic mafia state machine (S105 = M24.1a). Pure: no discord.js, no
// timers, no `Math.random` and no `Date.now()` of its own — a caller injects
// `random` and `now`. That is what lets a whole game be played out inside a
// test in a millisecond, and it is the only way a multi-hour game becomes
// testable at all (S73/S79/S81).
//
// Every mutator returns a NEW state plus the events it produced. The caller
// decides what to persist and what to say out loud; this file never speaks.
import { MIN_PLAYERS, ROLES, dealRoles, isMafia } from './roles.js';

export const PHASES = {
  LOBBY: 'lobby',
  NIGHT: 'night',
  DAY: 'day',
  VOTING: 'voting',
  JUDGEMENT: 'judgement',
  OVER: 'over',
};

/**
 * A player: `{ id, roleId, alive, diedOn, diedTo, lastProtected }`.
 * `lastProtected` is the medic's memory — the cog forbids protecting the same
 * person two nights running, and that rule needs somewhere to live.
 */

/** A fresh lobby. Nobody has a role until the game starts. */
export function createGame(hostId, { now = Date.now() } = {}) {
  return {
    hostId,
    phase: PHASES.LOBBY,
    day: 0,
    players: [{ id: hostId, roleId: null, alive: true, diedOn: null, diedTo: null, lastProtected: null }],
    // Night: actorId → targetId. Day: voterId → targetId. Judgement: voterId → 'guilty'|'innocent'.
    actions: {},
    votes: {},
    judgement: {},
    accusedId: null,
    winner: null,
    createdAt: now,
  };
}

export const playerOf = (game, id) => game.players.find((p) => p.id === id) ?? null;
export const alivePlayers = (game) => game.players.filter((p) => p.alive);
export const aliveMafia = (game) => alivePlayers(game).filter((p) => isMafia(p.roleId));
export const aliveVillagers = (game) => alivePlayers(game).filter((p) => !isMafia(p.roleId));
export const isAlive = (game, id) => Boolean(playerOf(game, id)?.alive);

/** Replace one player, returning a new players array. */
const withPlayer = (game, id, patch) =>
  game.players.map((p) => (p.id === id ? { ...p, ...patch } : p));

// ── the lobby ────────────────────────────────────────────────────────────────

export function joinGame(game, userId) {
  if (game.phase !== PHASES.LOBBY) return { ok: false, reason: 'started' };
  if (playerOf(game, userId)) return { ok: false, reason: 'already-in' };
  if (game.players.length >= 20) return { ok: false, reason: 'full' };
  return {
    ok: true,
    game: {
      ...game,
      players: [
        ...game.players,
        { id: userId, roleId: null, alive: true, diedOn: null, diedTo: null, lastProtected: null },
      ],
    },
  };
}

export function leaveGame(game, userId) {
  if (game.phase !== PHASES.LOBBY) return { ok: false, reason: 'started' };
  if (!playerOf(game, userId)) return { ok: false, reason: 'not-in' };
  // The host leaving ends the lobby: somebody has to own it, and silently
  // promoting a random member is a worse surprise than a cancelled game.
  if (userId === game.hostId) return { ok: false, reason: 'host' };
  return { ok: true, game: { ...game, players: game.players.filter((p) => p.id !== userId) } };
}

/**
 * Deal the roles and open the first night. The cog opens on night 1 rather
 * than a day, so the first thing that happens is the Boss choosing — a day
 * with zero information is a coin flip nobody enjoys.
 */
export function startGame(game, { random = Math.random, now = Date.now() } = {}) {
  if (game.phase !== PHASES.LOBBY) return { ok: false, reason: 'started' };
  if (game.players.length < MIN_PLAYERS) return { ok: false, reason: 'too-few' };

  const roles = dealRoles(game.players.length, random);
  return {
    ok: true,
    game: {
      ...game,
      phase: PHASES.NIGHT,
      day: 1,
      startedAt: now,
      players: game.players.map((p, i) => ({ ...p, roleId: roles[i] })),
      actions: {},
    },
  };
}

// ── night ────────────────────────────────────────────────────────────────────

/** Who still owes a night action — what the caller prompts, and waits for. */
export function pendingActors(game) {
  if (game.phase !== PHASES.NIGHT) return [];
  return alivePlayers(game)
    .filter((p) => ROLES[p.roleId]?.night)
    .filter((p) => game.actions[p.id] === undefined)
    .map((p) => p.id);
}

/**
 * Record a night action.
 *
 * The refusals are the interesting part, and each one is a rule rather than a
 * guard: the Boss may not shoot himself, the medic may not protect the same
 * person twice running, and nobody may act on a corpse.
 *
 * @returns {{ ok: boolean, reason?: string, game?: object }}
 */
export function submitNightAction(game, actorId, targetId) {
  if (game.phase !== PHASES.NIGHT) return { ok: false, reason: 'not-night' };
  const actor = playerOf(game, actorId);
  if (!actor?.alive) return { ok: false, reason: 'dead' };
  const role = ROLES[actor.roleId];
  if (!role?.night) return { ok: false, reason: 'no-action' };
  if (!isAlive(game, targetId)) return { ok: false, reason: 'target-dead' };
  if (role.night === 'kill' && targetId === actorId) return { ok: false, reason: 'no-self-kill' };
  if (role.night === 'protect' && actor.lastProtected === targetId) {
    return { ok: false, reason: 'repeat-protect' };
  }
  return { ok: true, game: { ...game, actions: { ...game.actions, [actorId]: targetId } } };
}

/**
 * Resolve the night and open the day.
 *
 * Order matters and is the cog's: protection is decided before the attack, so
 * a medic who guessed right saves the target outright. The detective's result
 * is returned as a private event rather than applied to the board — it is
 * information, and information is the whole game.
 *
 * @returns {{ game: object, events: object[] }}
 */
export function resolveNight(game, { now = Date.now() } = {}) {
  if (game.phase !== PHASES.NIGHT) return { game, events: [] };

  const events = [];
  let protectedId = null;
  let targetId = null;
  let killerId = null;

  for (const actor of alivePlayers(game)) {
    const choice = game.actions[actor.id];
    if (choice === undefined) continue;
    const action = ROLES[actor.roleId]?.night;
    if (action === 'protect') protectedId = choice;
    else if (action === 'kill') {
      targetId = choice;
      killerId = actor.id;
    } else if (action === 'investigate') {
      events.push({
        type: 'investigation',
        to: actor.id,
        targetId: choice,
        mafia: isMafia(playerOf(game, choice)?.roleId),
      });
    }
  }

  let players = game.players;
  // The medic remembers who they covered, whether or not it mattered.
  for (const actor of alivePlayers(game)) {
    if (ROLES[actor.roleId]?.night === 'protect' && game.actions[actor.id] !== undefined) {
      players = players.map((p) => (p.id === actor.id ? { ...p, lastProtected: game.actions[actor.id] } : p));
    }
  }

  if (targetId !== null && targetId === protectedId) {
    events.push({ type: 'saved', targetId });
  } else if (targetId !== null) {
    players = players.map((p) =>
      p.id === targetId ? { ...p, alive: false, diedOn: game.day, diedTo: 'mafia' } : p,
    );
    events.push({ type: 'killed', targetId, byId: killerId });
  } else {
    events.push({ type: 'quiet-night' });
  }

  const next = { ...game, players, phase: PHASES.DAY, actions: {}, votes: {}, resolvedAt: now };
  return { game: finishIfDecided(next), events };
}

// ── day: the vote ────────────────────────────────────────────────────────────

/** Move from discussion to the vote. */
export function openVoting(game) {
  if (game.phase !== PHASES.DAY) return { ok: false, reason: 'not-day' };
  return { ok: true, game: { ...game, phase: PHASES.VOTING, votes: {} } };
}

/**
 * Vote to put someone on trial. `null` is an explicit abstention — recorded,
 * because "nobody voted" and "everyone declined" should not look the same to
 * the room.
 */
export function castVote(game, voterId, targetId) {
  if (game.phase !== PHASES.VOTING) return { ok: false, reason: 'not-voting' };
  if (!isAlive(game, voterId)) return { ok: false, reason: 'dead' };
  if (targetId !== null && !isAlive(game, targetId)) return { ok: false, reason: 'target-dead' };
  return { ok: true, game: { ...game, votes: { ...game.votes, [voterId]: targetId } } };
}

/** Tally: targetId → count, abstentions excluded. */
export function voteTally(game) {
  const tally = {};
  for (const target of Object.values(game.votes)) {
    if (target === null) continue;
    tally[target] = (tally[target] ?? 0) + 1;
  }
  return tally;
}

/**
 * Close the vote.
 *
 * A plurality puts someone on trial; **a tie puts nobody on trial**. That is
 * deliberate and it is the cog's behaviour: breaking a tie by coin flip means
 * the game can execute someone the room did not actually choose.
 *
 * @returns {{ game: object, accusedId: string|null, tally: object }}
 */
export function closeVoting(game) {
  if (game.phase !== PHASES.VOTING) return { game, accusedId: null, tally: {} };
  const tally = voteTally(game);
  const counts = Object.values(tally);
  const top = counts.length > 0 ? Math.max(...counts) : 0;
  const leaders = Object.keys(tally).filter((id) => tally[id] === top);

  if (leaders.length !== 1 || top === 0) {
    // Nobody on trial — straight to night.
    return { game: toNight({ ...game, accusedId: null }), accusedId: null, tally };
  }
  return {
    game: { ...game, phase: PHASES.JUDGEMENT, accusedId: leaders[0], judgement: {} },
    accusedId: leaders[0],
    tally,
  };
}

// ── judgement ────────────────────────────────────────────────────────────────

/** Guilty or innocent. The accused does not get a say — the cog's rule. */
export function castJudgement(game, voterId, verdict) {
  if (game.phase !== PHASES.JUDGEMENT) return { ok: false, reason: 'not-judgement' };
  if (!isAlive(game, voterId)) return { ok: false, reason: 'dead' };
  if (voterId === game.accusedId) return { ok: false, reason: 'accused' };
  if (verdict !== 'guilty' && verdict !== 'innocent') return { ok: false, reason: 'bad-verdict' };
  return { ok: true, game: { ...game, judgement: { ...game.judgement, [voterId]: verdict } } };
}

/**
 * Deliver the verdict. **A tie acquits** — the same reasoning as the vote: a
 * town that cannot agree to execute someone has not agreed to execute them.
 *
 * @returns {{ game: object, guilty: boolean, counts: { guilty: number, innocent: number } }}
 */
export function closeJudgement(game) {
  if (game.phase !== PHASES.JUDGEMENT) return { game, guilty: false, counts: { guilty: 0, innocent: 0 } };
  const verdicts = Object.values(game.judgement);
  const counts = {
    guilty: verdicts.filter((v) => v === 'guilty').length,
    innocent: verdicts.filter((v) => v === 'innocent').length,
  };
  const guilty = counts.guilty > counts.innocent;

  const players = guilty
    ? withPlayer(game, game.accusedId, { alive: false, diedOn: game.day, diedTo: 'lynch' })
    : game.players;

  const settled = finishIfDecided({ ...game, players });
  return {
    game: settled.phase === PHASES.OVER ? settled : toNight(settled),
    guilty,
    counts,
  };
}

// ── phase plumbing and the end ───────────────────────────────────────────────

/** Open the next night. */
function toNight(game) {
  return {
    ...game,
    phase: PHASES.NIGHT,
    day: game.day + 1,
    actions: {},
    votes: {},
    judgement: {},
    accusedId: null,
  };
}

/**
 * Who has won, if anyone.
 *
 * - Villagers win when no mafia is left alive.
 * - Mafia win when they are **not outnumbered** — at parity they can no longer
 *   be voted out, so the game is over and playing it out changes nothing.
 *
 * The cog's roles state their objectives ("kill all villagers") rather than
 * writing this rule down in one place; parity is the near-universal reading
 * and the one recorded in the manual as a stated rule.
 */
export function checkWinner(game) {
  const mafia = aliveMafia(game).length;
  const villagers = aliveVillagers(game).length;
  if (mafia === 0) return 'villagers';
  if (mafia >= villagers) return 'mafia';
  return null;
}

/** Stamp the winner and stop, or hand the state back untouched. */
export function finishIfDecided(game) {
  const winner = checkWinner(game);
  if (!winner) return game;
  return { ...game, phase: PHASES.OVER, winner, accusedId: null };
}

/** Everyone's role, for the reveal at the end. */
export const spoiler = (game) =>
  game.players.map((p) => ({ id: p.id, roleId: p.roleId, alive: p.alive, diedTo: p.diedTo }));
