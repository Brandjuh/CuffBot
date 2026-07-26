// The mafia role cards (S105 Classic, S108 = M24.2 the second tier). Ported
// from AAA3A's `mafiagame` (MIT); every side, ability and quirk below was read
// out of the cog's `roles.py` rather than remembered.
//
// The cog has 57 roles. This is 13 — the set its Classic, Crazy and Chaos
// modes actually deal — and that is a deliberate stopping point, not an
// unfinished list: each further role interacts with every other one.
//
// Pure data and pure functions. No discord.js, and no randomness of its own —
// a caller injects `random` so a test can pin every deal.

export const SIDES = { MAFIA: 'mafia', VILLAGERS: 'villagers', NEUTRAL: 'neutral' };

/**
 * Roles keyed by id.
 *
 * - `night` names the action taken after dark; `null` means they sleep.
 * - `starting: false` means the role is never DEALT — it is only reached by
 *   another role changing into it (the cog's own flag; only the Jester has it).
 * - `visits` is whether the night action counts as visiting the target, which
 *   is the only thing the Spy can see.
 */
export const ROLES = {
  // ── the mafia ──────────────────────────────────────────────────────────────
  godfather: {
    id: 'godfather',
    name: 'The Boss',
    emoji: '🔫',
    side: SIDES.MAFIA,
    description:
      'The one giving the orders. Every crook in this precinct answers to you, and nobody knows your face.',
    ability: 'Each night, pick someone to take out. They do not see morning unless the medic got there first.',
    objective: 'Outnumber the honest officers.',
    night: 'kill',
    // The cog's God Father does not visit when a Mafia carries out the order.
    // With one shooter on the board the distinction never shows, so the
    // simpler faithful reading is kept: the Boss visits when the Boss shoots.
    visits: true,
  },
  mafia: {
    id: 'mafia',
    name: 'The Enforcer',
    emoji: '🔪',
    side: SIDES.MAFIA,
    description: 'You do not decide who. You decide how quietly.',
    ability:
      'You carry out the Boss’s order. If the Boss is taken off the board, **you become the Boss**.',
    objective: 'Help the Boss outnumber the officers.',
    night: 'kill',
    visits: true,
  },
  framer: {
    id: 'framer',
    name: 'The Framer',
    emoji: '🖊️',
    side: SIDES.MAFIA,
    description: 'Evidence is only as honest as whoever filed it.',
    ability: 'Each night, pick someone. Tonight, every investigation reads them as mafia.',
    objective: 'Point the precinct at the wrong officer.',
    night: 'frame',
    visits: true,
  },

  // ── the precinct ───────────────────────────────────────────────────────────
  doctor: {
    id: 'doctor',
    name: 'The Medic',
    emoji: '🩺',
    side: SIDES.VILLAGERS,
    description: 'The precinct’s only medical professional, and the reason some nights end better than they started.',
    // The cog forbids covering the same person two nights running. Kept:
    // without it the medic parks on one officer and the night stops being a
    // decision.
    ability: 'Each night, pick someone to protect. You cannot protect the same person two nights in a row.',
    objective: 'Keep the Boss’s victims breathing.',
    night: 'protect',
    visits: true,
  },
  detective: {
    id: 'detective',
    name: 'The Detective',
    emoji: '🕵️',
    side: SIDES.VILLAGERS,
    description: 'Another case, another late night. Somebody in this room is dirty and you intend to say who.',
    ability: 'Each night, investigate someone. You learn whether they are with the mafia — nothing more.',
    objective: 'Name the Boss before the Boss names you.',
    night: 'investigate',
    visits: true,
  },
  vigilante: {
    id: 'vigilante',
    name: 'The Vigilante',
    emoji: '🔦',
    side: SIDES.VILLAGERS,
    description: 'Badge in a drawer, gun in a coat. Someone has to do something.',
    // The cog's rule exactly, and the reason the card is dangerous: shoot an
    // innocent and you go with them.
    ability: 'Each night you may shoot someone. **If they were innocent, you do not survive the guilt.**',
    objective: 'Put the mafia in the ground yourself.',
    night: 'shoot',
    visits: true,
  },
  mayor: {
    id: 'mayor',
    name: 'The Commissioner',
    emoji: '🎖️',
    side: SIDES.VILLAGERS,
    description: 'The precinct’s public face. Announcing it makes you a target and makes you heard.',
    ability: 'Reveal yourself at night. From then on **your vote counts twice** — and everyone knows who you are.',
    objective: 'Get the mafia voted out.',
    night: 'reveal',
    visits: false, // revealing is a declaration, not a visit
  },
  spy: {
    id: 'spy',
    name: 'The Tail',
    emoji: '👁️',
    side: SIDES.VILLAGERS,
    description: 'You do not need to hear what was said. You only need to know who went where.',
    ability: 'Each night, follow someone. You learn **who they visited**, not what they did.',
    objective: 'Bring the precinct the movements it cannot see.',
    night: 'follow',
    visits: true,
  },
  investigator: {
    id: 'investigator',
    name: 'The Private Eye',
    emoji: '🔍',
    side: SIDES.VILLAGERS,
    description: 'Hired by nobody, answering to nobody, right more often than the payroll detectives.',
    ability: 'Each night, pick **two** people. You learn whether they are on the same side.',
    objective: 'Gather what the precinct cannot.',
    night: 'compare',
    visits: true,
  },
  distractor: {
    id: 'distractor',
    name: 'The Distraction',
    emoji: '💃',
    side: SIDES.VILLAGERS,
    description: 'Nobody gets any work done while you are in the room. That is the work.',
    ability: 'Each night, pick someone. **Their night action does not happen.**',
    objective: 'Keep the bad guys busy.',
    night: 'block',
    visits: true,
  },
  villager: {
    id: 'villager',
    name: 'Officer',
    emoji: '👮',
    side: SIDES.VILLAGERS,
    description: 'No badge number worth mentioning, no special talent. Just a vote and an opinion.',
    ability: 'None at night. By day your vote counts exactly as much as anyone’s — which is the whole point.',
    objective: 'Vote out the mafia.',
    night: null,
    visits: false,
  },

  // ── neutrals: their own win, and it does not end the game ──────────────────
  executioner: {
    id: 'executioner',
    name: 'The Executioner',
    emoji: '⚖️',
    side: SIDES.NEUTRAL,
    description:
      'Someone in this precinct wronged you. Nobody remembers what they did. You remember exactly.',
    ability:
      'You are given one target at the start. **You win the moment the town votes them out** — whoever else wins.',
    objective: 'Get your target lynched.',
    night: null,
    visits: false,
    // The cog: if the target dies any other way, the Executioner has failed
    // and becomes a Jester.
    failsInto: 'jester',
  },
  jester: {
    id: 'jester',
    name: 'The Jester',
    emoji: '🃏',
    side: SIDES.NEUTRAL,
    description:
      'Sitting in the corner, delighted. The mob outside wants a hanging. The Jester does not fear death — death fears the Jester.',
    ability: '**You win by being voted out.** That is the whole card.',
    objective: 'Get yourself lynched.',
    night: null,
    visits: false,
    // The cog's own flag: never dealt, only arrived at.
    starting: false,
  },
};

export const roleOf = (id) => ROLES[id] ?? null;
export const sideOf = (roleId) => ROLES[roleId]?.side ?? SIDES.VILLAGERS;
export const isMafia = (roleId) => sideOf(roleId) === SIDES.MAFIA;
export const isNeutral = (roleId) => sideOf(roleId) === SIDES.NEUTRAL;

/** The cog's Classic core, in its order. */
export const CLASSIC_CORE = ['godfather', 'detective', 'doctor'];

export const MIN_PLAYERS = 5;
/** Above this the day phase is unmanageable in one text channel. */
export const MAX_PLAYERS = 20;

/**
 * The three modes, transcribed from the cog's `modes.py`.
 *
 * `bands` are read in order; the first whose [min, max] contains the player
 * count wins. `must` is always dealt; `choices` pick `pick` roles from a list
 * (`pick: 'fill'` means "take as many as there is room for"); `may` adds one
 * at random half the time, which is the cog's own coin flip.
 */
export const MODES = {
  classic: {
    id: 'classic',
    name: 'Classic',
    emoji: '🏛️',
    description: 'The three classic cards and a room full of officers.',
    bands: [{ min: 5, max: null, must: CLASSIC_CORE }],
  },
  crazy: {
    id: 'crazy',
    name: 'Crazy',
    emoji: '🤪',
    description: 'Classic plus the loud cards — a vigilante, a commissioner and an executioner.',
    bands: [
      { min: 5, max: 5, must: CLASSIC_CORE, choices: [{ pick: 2, from: ['vigilante', 'mayor', 'executioner'] }] },
      { min: 6, max: null, must: [...CLASSIC_CORE, 'vigilante', 'mayor', 'executioner'] },
    ],
  },
  chaos: {
    id: 'chaos',
    name: 'Chaos',
    emoji: '🌀',
    description: 'Everything on the table. Nobody knows what is in the room.',
    bands: [
      {
        min: 5,
        max: 7,
        must: CLASSIC_CORE,
        may: ['executioner'],
        choices: [{ pick: 'fill', from: ['vigilante', 'mayor', 'spy', 'investigator', 'distractor'] }],
      },
      {
        min: 8,
        max: 9,
        must: CLASSIC_CORE,
        may: ['executioner'],
        choices: [
          { pick: 1, from: ['mafia', 'framer'] },
          { pick: 'fill', from: ['vigilante', 'mayor', 'spy', 'investigator', 'distractor'] },
        ],
      },
      {
        min: 10,
        max: 10,
        must: [...CLASSIC_CORE, 'executioner'],
        choices: [
          { pick: 1, from: ['mafia', 'framer'] },
          { pick: 'fill', from: ['vigilante', 'mayor', 'spy', 'investigator', 'distractor'] },
        ],
      },
      {
        min: 11,
        max: null,
        must: [...CLASSIC_CORE, 'vigilante', 'mayor', 'spy', 'investigator', 'distractor', 'mafia', 'framer'],
        choices: [{ pick: 1, from: ['executioner'] }],
      },
    ],
  },
};

export const DEFAULT_MODE = 'classic';
export const modeOf = (id) => MODES[String(id ?? '').toLowerCase()] ?? null;

/**
 * Fisher–Yates with an injected source, so a test can deal a known hand and
 * `Math.random` never appears in the engine.
 */
export function shuffle(items, random = Math.random) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Take `n` distinct entries from `list`, without mutating it. */
function sample(list, n, random) {
  return shuffle(list, random).slice(0, Math.max(0, n));
}

/** The band whose player range contains `count`. */
export function bandFor(mode, count) {
  return (
    mode.bands.find((b) => count >= b.min && (b.max === null || count <= b.max)) ??
    mode.bands[mode.bands.length - 1]
  );
}

/**
 * Deal roles for `count` players in `modeId`. Officers fill whatever is left,
 * and the result is shuffled so seat order says nothing.
 *
 * @returns {string[]} role ids, shuffled
 */
export function dealRoles(count, modeId = DEFAULT_MODE, random = Math.random) {
  if (!Number.isInteger(count) || count < MIN_PLAYERS) {
    throw new Error(`Mafia needs at least ${MIN_PLAYERS} players`);
  }
  if (count > MAX_PLAYERS) throw new Error(`Mafia tops out at ${MAX_PLAYERS} players`);
  const mode = modeOf(modeId);
  if (!mode) throw new Error(`Unknown mode "${modeId}"`);

  const band = bandFor(mode, count);
  const roles = [...band.must];

  // The cog's coin flip: a `may` role joins about half the time, and only if
  // there is still a seat for it.
  if (band.may && roles.length < count && random() < 0.5) {
    roles.push(...sample(band.may, 1, random));
  }
  for (const choice of band.choices ?? []) {
    const room = count - roles.length;
    if (room <= 0) break;
    const take = choice.pick === 'fill' ? Math.min(choice.from.length, room) : Math.min(choice.pick, room);
    roles.push(...sample(choice.from, take, random));
  }
  while (roles.length < count) roles.push('villager');

  // A band can over-fill at the bottom of its range; trimming from the end
  // keeps `must` intact, which is what makes a mode mean anything.
  return shuffle(roles.slice(0, count), random);
}
