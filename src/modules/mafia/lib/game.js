// The mafia state machine (S105 Classic, S108 = M24.2 the second tier). Pure:
// no discord.js, no timers, no `Math.random` and no `Date.now()` of its own —
// a caller injects `random` and `now`. That is what lets a whole game be
// played out inside a test in a millisecond, and it is the only way a
// multi-hour game becomes testable at all (S73/S79/S81).
//
// Every mutator returns a NEW state plus the events it produced. The caller
// decides what to persist and what to say out loud; this file never speaks.
import {
  DEFAULT_MODE,
  MIN_PLAYERS,
  ROLES,
  SIDES,
  dealRoles,
  isMafia,
  isNeutral,
  shuffle,
  sideOf,
} from './roles.js';

export const PHASES = {
  LOBBY: 'lobby',
  NIGHT: 'night',
  DAY: 'day',
  VOTING: 'voting',
  JUDGEMENT: 'judgement',
  OVER: 'over',
};

/**
 * A player: `{ id, roleId, alive, diedOn, diedTo, lastProtected, revealed,
 * targetId }`.
 * - `lastProtected` is the medic's memory (no covering the same person twice).
 * - `revealed` is the Commissioner's declaration, and is permanent.
 * - `targetId` is the Executioner's mark, assigned at deal time.
 */
const freshPlayer = (id) => ({
  id,
  roleId: null,
  alive: true,
  diedOn: null,
  diedTo: null,
  lastProtected: null,
  revealed: false,
  targetId: null,
  wonAs: null, // a neutral's personal win, recorded the moment it happens
});

/** A fresh lobby. Nobody has a role until the game starts. */
export function createGame(hostId, { mode = DEFAULT_MODE, now = Date.now() } = {}) {
  return {
    hostId,
    mode,
    phase: PHASES.LOBBY,
    day: 0,
    players: [freshPlayer(hostId)],
    // Night: actorId → targetId (or [a, b] for the Private Eye). Day: voterId
    // → targetId. Judgement: voterId → 'guilty'|'innocent'.
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
export const aliveVillagers = (game) => alivePlayers(game).filter((p) => sideOf(p.roleId) === SIDES.VILLAGERS);
export const aliveNeutrals = (game) => alivePlayers(game).filter((p) => isNeutral(p.roleId));
export const isAlive = (game, id) => Boolean(playerOf(game, id)?.alive);

const withPlayer = (game, id, patch) =>
  game.players.map((p) => (p.id === id ? { ...p, ...patch } : p));

// ── the lobby ────────────────────────────────────────────────────────────────

export function joinGame(game, userId) {
  if (game.phase !== PHASES.LOBBY) return { ok: false, reason: 'started' };
  if (playerOf(game, userId)) return { ok: false, reason: 'already-in' };
  if (game.players.length >= 20) return { ok: false, reason: 'full' };
  return { ok: true, game: { ...game, players: [...game.players, freshPlayer(userId)] } };
}

export function leaveGame(game, userId) {
  if (game.phase !== PHASES.LOBBY) return { ok: false, reason: 'started' };
  if (!playerOf(game, userId)) return { ok: false, reason: 'not-in' };
  // The host leaving ends the lobby: somebody has to own it, and silently
  // promoting a random member is a worse surprise than a cancelled game.
  if (userId === game.hostId) return { ok: false, reason: 'host' };
  return { ok: true, game: { ...game, players: game.players.filter((p) => p.id !== userId) } };
}

/** Change the mode before the deal. */
export function setMode(game, mode) {
  if (game.phase !== PHASES.LOBBY) return { ok: false, reason: 'started' };
  return { ok: true, game: { ...game, mode } };
}

/**
 * Deal the roles and open the first night. The cog opens on night 1 rather
 * than a day, so the first thing that happens is the Boss choosing — a day
 * with zero information is a coin flip nobody enjoys.
 */
export function startGame(game, { random = Math.random, now = Date.now() } = {}) {
  if (game.phase !== PHASES.LOBBY) return { ok: false, reason: 'started' };
  if (game.players.length < MIN_PLAYERS) return { ok: false, reason: 'too-few' };

  const roles = dealRoles(game.players.length, game.mode, random);
  let players = game.players.map((p, i) => ({ ...p, roleId: roles[i] }));

  // The Executioner's mark: a random VILLAGER-side player, never themselves —
  // the cog's own rule, and the reason the card is playable at all (marking a
  // mafia would make it a second detective).
  for (const exec of players.filter((p) => p.roleId === 'executioner')) {
    const candidates = players.filter((p) => p.id !== exec.id && sideOf(p.roleId) === SIDES.VILLAGERS);
    const mark = shuffle(candidates, random)[0];
    // No villager to mark (a tiny all-special table): the card is pointless,
    // so it fails immediately into the Jester rather than sitting unwinnable.
    players = players.map((p) =>
      p.id === exec.id ? { ...p, targetId: mark?.id ?? null, roleId: mark ? 'executioner' : 'jester' } : p,
    );
  }

  return {
    ok: true,
    game: { ...game, phase: PHASES.NIGHT, day: 1, startedAt: now, players, actions: {} },
  };
}

// ── night ────────────────────────────────────────────────────────────────────

/** Who still owes a night action — what the caller prompts, and waits for. */
export function pendingActors(game) {
  if (game.phase !== PHASES.NIGHT) return [];
  return alivePlayers(game)
    .filter((p) => ROLES[p.roleId]?.night)
    // The Commissioner reveals ONCE; after that they have nothing to do at
    // night and the table must not wait for them.
    .filter((p) => !(p.roleId === 'mayor' && p.revealed))
    .filter((p) => game.actions[p.id] === undefined)
    .map((p) => p.id);
}

/** How many targets this role's night action takes. */
export const targetCountFor = (roleId) => (roleId === 'investigator' ? 2 : ROLES[roleId]?.night === 'reveal' ? 0 : 1);

/**
 * Record a night action.
 *
 * Every refusal is a rule rather than a guard: the shooters may not pick
 * themselves, the medic may not repeat, the Private Eye needs two DIFFERENT
 * people, and nobody may act on a corpse.
 *
 * @param {string|string[]} target one id, or two for the Private Eye
 * @returns {{ ok: boolean, reason?: string, game?: object }}
 */
export function submitNightAction(game, actorId, target) {
  if (game.phase !== PHASES.NIGHT) return { ok: false, reason: 'not-night' };
  const actor = playerOf(game, actorId);
  if (!actor?.alive) return { ok: false, reason: 'dead' };
  const role = ROLES[actor.roleId];
  if (!role?.night) return { ok: false, reason: 'no-action' };
  if (actor.roleId === 'mayor' && actor.revealed) return { ok: false, reason: 'already-revealed' };

  if (role.night === 'reveal') {
    return { ok: true, game: { ...game, actions: { ...game.actions, [actorId]: true } } };
  }

  const targets = Array.isArray(target) ? target : [target];
  if (targets.length !== targetCountFor(actor.roleId)) return { ok: false, reason: 'wrong-target-count' };
  if (new Set(targets).size !== targets.length) return { ok: false, reason: 'same-target-twice' };
  if (targets.some((t) => !isAlive(game, t))) return { ok: false, reason: 'target-dead' };
  if (['kill', 'shoot'].includes(role.night) && targets.includes(actorId)) {
    return { ok: false, reason: 'no-self-kill' };
  }
  if (role.night === 'protect' && actor.lastProtected === targets[0]) {
    return { ok: false, reason: 'repeat-protect' };
  }

  return {
    ok: true,
    game: { ...game, actions: { ...game.actions, [actorId]: Array.isArray(target) ? targets : targets[0] } },
  };
}

/** Both shooters, in the order the cog resolves them. */
const KILL_ACTIONS = ['kill', 'shoot'];

/**
 * Resolve the night and open the day.
 *
 * **The order is the whole feature**, and it is the cog's:
 *   1. **Blocks** — the Distraction goes first, or nothing she stops happens.
 *   2. **Frames** — the Framer marks before anyone reads anyone.
 *   3. **Protection** — the medic covers before the shots land.
 *   4. **Kills** — mafia first, then the Vigilante (who may shoot themselves
 *      in the foot, and does so only if their target was innocent).
 *   5. **Information** — detective, Private Eye and Tail read the state the
 *      four steps above produced, and get PRIVATE events. Information is the
 *      whole game, so none of it touches the shared board.
 *
 * @returns {{ game: object, events: object[] }}
 */
export function resolveNight(game, { now = Date.now() } = {}) {
  if (game.phase !== PHASES.NIGHT) return { game, events: [] };
  const events = [];

  const actionOf = (p) => ROLES[p.roleId]?.night;
  const choiceOf = (p) => game.actions[p.id];
  const actors = alivePlayers(game).filter((p) => choiceOf(p) !== undefined && actionOf(p));

  // 1. Blocks.
  const blocked = new Set();
  for (const actor of actors.filter((p) => actionOf(p) === 'block')) {
    const victim = playerOf(game, choiceOf(actor));
    // Blocking someone with nothing to do is legal and simply wastes the night.
    if (victim && ROLES[victim.roleId]?.night) blocked.add(victim.id);
    events.push({ type: 'blocked', to: actor.id, targetId: choiceOf(actor) });
  }
  const active = actors.filter((p) => !blocked.has(p.id));
  for (const id of blocked) {
    if (game.actions[id] !== undefined) events.push({ type: 'was-blocked', to: id });
  }

  // The visit log — the only thing the Tail can see. Built from who ACTUALLY
  // acted, so a blocked visitor never went anywhere.
  const visits = new Map(); // actorId → targetId[]
  for (const actor of active) {
    if (!ROLES[actor.roleId]?.visits) continue;
    const choice = choiceOf(actor);
    visits.set(actor.id, Array.isArray(choice) ? choice : [choice]);
  }

  // 2. Frames.
  const framed = new Set(
    active.filter((p) => actionOf(p) === 'frame').map((p) => choiceOf(p)).filter(Boolean),
  );

  // 3. Protection, and the medic's memory — kept whether or not it mattered.
  const guarded = new Set(active.filter((p) => actionOf(p) === 'protect').map((p) => choiceOf(p)));
  let players = game.players;
  for (const actor of actors.filter((p) => actionOf(p) === 'protect')) {
    players = players.map((p) => (p.id === actor.id ? { ...p, lastProtected: choiceOf(actor) } : p));
  }

  // The Commissioner's reveal is permanent and public.
  for (const actor of active.filter((p) => actionOf(p) === 'reveal')) {
    players = players.map((p) => (p.id === actor.id ? { ...p, revealed: true } : p));
    events.push({ type: 'revealed', playerId: actor.id });
  }

  // 4. Kills.
  const dead = new Set();
  const kill = (id, cause) => {
    if (dead.has(id) || guarded.has(id)) {
      if (guarded.has(id) && !dead.has(id)) events.push({ type: 'saved', targetId: id });
      return false;
    }
    dead.add(id);
    players = players.map((p) => (p.id === id ? { ...p, alive: false, diedOn: game.day, diedTo: cause } : p));
    events.push({ type: 'killed', targetId: id, cause });
    return true;
  };

  for (const actor of active.filter((p) => actionOf(p) === 'kill')) kill(choiceOf(actor), 'mafia');
  for (const actor of active.filter((p) => actionOf(p) === 'shoot')) {
    const targetId = choiceOf(actor);
    const wasInnocent = sideOf(playerOf(game, targetId)?.roleId) !== SIDES.MAFIA;
    const landed = kill(targetId, 'vigilante');
    // The cog's rule: shooting an innocent costs the Vigilante their own life.
    // A protected target means the shot never landed, so no guilt either.
    if (landed && wasInnocent) {
      kill(actor.id, 'guilt');
      events.push({ type: 'vigilante-guilt', playerId: actor.id, targetId });
    }
  }

  // 5. Information, read AFTER everything above.
  const sideSeenBy = (id) => (framed.has(id) ? SIDES.MAFIA : sideOf(playerOf(game, id)?.roleId));
  for (const actor of active) {
    const choice = choiceOf(actor);
    switch (actionOf(actor)) {
      case 'investigate':
        events.push({
          type: 'investigation',
          to: actor.id,
          targetId: choice,
          mafia: sideSeenBy(choice) === SIDES.MAFIA,
        });
        break;
      case 'compare':
        events.push({
          type: 'comparison',
          to: actor.id,
          targetIds: choice,
          same: sideSeenBy(choice[0]) === sideSeenBy(choice[1]),
        });
        break;
      case 'follow':
        events.push({
          type: 'tail',
          to: actor.id,
          targetId: choice,
          // Who they visited — never what they did. That is the card.
          visited: visits.get(choice) ?? [],
        });
        break;
      default:
    }
  }

  if (dead.size === 0 && !events.some((e) => e.type === 'saved')) {
    events.push({ type: 'quiet-night' });
  }

  const next = afterDeaths({ ...game, players, phase: PHASES.DAY, actions: {}, votes: {}, resolvedAt: now }, events);
  return { game: finishIfDecided(next), events };
}

/**
 * Everything that follows from somebody dying, whichever way they died.
 *
 * This runs after a night AND after a lynch. Keeping it in one place is not
 * tidiness: S108's own tests caught a lynched Boss leaving an Enforcer who
 * could never shoot, because succession used to live inside `resolveNight`.
 */
function afterDeaths(game, events) {
  return failExecutioners(promoteMafia(game, events), events);
}

/**
 * The cog's succession: with the Boss gone, an Enforcer takes over. Without
 * it, killing the Boss would leave a mafia that can no longer shoot.
 */
function promoteMafia(game, events) {
  if (aliveMafia(game).some((p) => p.roleId === 'godfather')) return game;
  const heir = aliveMafia(game).find((p) => p.roleId === 'mafia');
  if (!heir) return game;
  events.push({ type: 'promoted', playerId: heir.id });
  return { ...game, players: withPlayer(game, heir.id, { roleId: 'godfather' }) };
}

/**
 * An Executioner whose mark died any way OTHER than a lynch has failed, and
 * the cog turns them into a Jester. Their win is still reachable — it just
 * changed shape.
 */
function failExecutioners(game, events) {
  let players = game.players;
  for (const exec of game.players.filter((p) => p.roleId === 'executioner' && p.alive)) {
    const mark = playerOf(game, exec.targetId);
    if (!mark || mark.alive || mark.diedTo === 'lynch') continue;
    players = players.map((p) => (p.id === exec.id ? { ...p, roleId: 'jester' } : p));
    events?.push({ type: 'executioner-failed', to: exec.id, targetId: exec.targetId });
  }
  return { ...game, players };
}

// ── day: the vote ────────────────────────────────────────────────────────────

export function openVoting(game) {
  if (game.phase !== PHASES.DAY) return { ok: false, reason: 'not-day' };
  return { ok: true, game: { ...game, phase: PHASES.VOTING, votes: {} } };
}

/** A revealed Commissioner carries two votes. Everyone else carries one. */
export const voteWeightOf = (player) => (player?.roleId === 'mayor' && player.revealed ? 2 : 1);

/**
 * Vote to put someone on trial. `null` is an explicit abstention — recorded,
 * because "nobody voted" and "everyone declined" should not look the same.
 */
export function castVote(game, voterId, targetId) {
  if (game.phase !== PHASES.VOTING) return { ok: false, reason: 'not-voting' };
  if (!isAlive(game, voterId)) return { ok: false, reason: 'dead' };
  if (targetId !== null && !isAlive(game, targetId)) return { ok: false, reason: 'target-dead' };
  return { ok: true, game: { ...game, votes: { ...game.votes, [voterId]: targetId } } };
}

/** Tally by WEIGHT, not by head count — abstentions excluded. */
export function voteTally(game) {
  const tally = {};
  for (const [voterId, target] of Object.entries(game.votes)) {
    if (target === null) continue;
    tally[target] = (tally[target] ?? 0) + voteWeightOf(playerOf(game, voterId));
  }
  return tally;
}

/**
 * Close the vote. A plurality puts someone on trial; **a tie puts nobody on
 * trial** — the cog's behaviour, and deliberate: breaking a tie by coin flip
 * means executing someone the room did not actually choose.
 */
export function closeVoting(game) {
  if (game.phase !== PHASES.VOTING) return { game, accusedId: null, tally: {} };
  const tally = voteTally(game);
  const counts = Object.values(tally);
  const top = counts.length > 0 ? Math.max(...counts) : 0;
  const leaders = Object.keys(tally).filter((id) => tally[id] === top);

  if (leaders.length !== 1 || top === 0) {
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
 * The Commissioner's extra vote counts here too.
 *
 * @returns {{ game, guilty, counts, personalWins: object[] }}
 */
export function closeJudgement(game) {
  if (game.phase !== PHASES.JUDGEMENT) {
    return { game, guilty: false, counts: { guilty: 0, innocent: 0 }, personalWins: [] };
  }
  const counts = { guilty: 0, innocent: 0 };
  for (const [voterId, verdict] of Object.entries(game.judgement)) {
    counts[verdict] += voteWeightOf(playerOf(game, voterId));
  }
  const guilty = counts.guilty > counts.innocent;

  let players = game.players;
  const personalWins = [];
  if (guilty) {
    players = withPlayer(game, game.accusedId, { alive: false, diedOn: game.day, diedTo: 'lynch' });
    // A lynch is the ONLY death that pays a neutral, and it pays two of them.
    const accused = playerOf(game, game.accusedId);
    if (accused?.roleId === 'jester') {
      personalWins.push({ playerId: accused.id, as: 'jester' });
    }
    for (const exec of players.filter((p) => p.roleId === 'executioner' && p.targetId === game.accusedId)) {
      personalWins.push({ playerId: exec.id, as: 'executioner' });
    }
    for (const win of personalWins) {
      players = players.map((p) => (p.id === win.playerId ? { ...p, wonAs: win.as } : p));
    }
  }

  const consequences = [];
  const settled = finishIfDecided(afterDeaths({ ...game, players }, consequences));
  return {
    game: settled.phase === PHASES.OVER ? settled : toNight(settled),
    guilty,
    counts,
    personalWins,
    // Succession and a failed Executioner can both follow a lynch; the caller
    // announces them the same way it announces a night's.
    events: consequences,
  };
}

// ── phase plumbing and the end ───────────────────────────────────────────────

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
 * Who has won the GAME, if anyone.
 *
 * - Villagers win when no mafia is left alive.
 * - Mafia win when they are **not outnumbered** by everyone else alive — at
 *   parity they can no longer be voted out, so the game is over and playing it
 *   out changes nothing.
 *
 * **Neutrals are counted as "everyone else" but win separately.** A Jester who
 * is lynched has already won (`wonAs`) and the game keeps going; nothing a
 * neutral does ends it. That is the cog's model, and it is why `wonAs` exists
 * alongside `winner` instead of being folded into it.
 */
export function checkWinner(game) {
  const mafia = aliveMafia(game).length;
  const others = alivePlayers(game).length - mafia;
  if (mafia === 0) return 'villagers';
  if (mafia >= others) return 'mafia';
  return null;
}

/** Stamp the winner and stop, or hand the state back untouched. */
export function finishIfDecided(game) {
  const winner = checkWinner(game);
  if (!winner) return game;
  return { ...game, phase: PHASES.OVER, winner, accusedId: null };
}

/** Everyone who achieved a personal objective, whoever won the game. */
export const personalWinners = (game) =>
  game.players.filter((p) => p.wonAs).map((p) => ({ playerId: p.id, as: p.wonAs }));

/** Everyone's role, for the reveal at the end. */
export const spoiler = (game) =>
  game.players.map((p) => ({
    id: p.id,
    roleId: p.roleId,
    alive: p.alive,
    diedTo: p.diedTo,
    wonAs: p.wonAs,
  }));
