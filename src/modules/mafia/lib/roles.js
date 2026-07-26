// The four Classic-mode roles (S105 = M24.1a). Ported from AAA3A's
// `mafiagame` (MIT), whose Classic mode is exactly `ALWAYS_MUST = [GodFather,
// Detective, Doctor]` plus Villagers to fill — verified in the cog's modes.py
// before a line of this was written.
//
// The cog has 57 roles. The other 53 are M24.2+ and are deliberately absent:
// every one of them interacts with every other, so adding them is a design
// problem, not a copy-paste one.
//
// Pure data and pure functions. No discord.js, no randomness of its own — a
// caller injects `random` so a test can pin every deal.

export const SIDES = { MAFIA: 'mafia', VILLAGERS: 'villagers' };

/**
 * Roles keyed by id. `night` names the action the role takes after dark;
 * `null` means they sleep. The precinct flavour sits in `name`/`description`
 * while the mechanics keep the cog's semantics exactly.
 */
export const ROLES = {
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
  },
  doctor: {
    id: 'doctor',
    name: 'The Medic',
    emoji: '🩺',
    side: SIDES.VILLAGERS,
    description: 'The precinct’s only medical professional, and the reason some nights end better than they started.',
    // The cog's Doctor cannot save the same person two nights running. Kept:
    // without it the medic simply parks on one officer and the night phase
    // stops being a decision.
    ability: 'Each night, pick someone to protect. You cannot protect the same person two nights in a row.',
    objective: 'Keep the Boss’s victims breathing.',
    night: 'protect',
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
  },
};

/** Classic mode's fixed core, in the cog's order. */
export const CLASSIC_CORE = ['godfather', 'detective', 'doctor'];

/** The cog's Classic mode opens at 5. Below that one lynch decides everything. */
export const MIN_PLAYERS = 5;
/** Above this the day phase is unmanageable in one text channel. */
export const MAX_PLAYERS = 20;

export const roleOf = (id) => ROLES[id] ?? null;
export const isMafia = (roleId) => ROLES[roleId]?.side === SIDES.MAFIA;

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

/**
 * Deal Classic-mode roles to `count` players: the three core roles, then
 * Officers to fill. One mafia at every table size — that is what Classic
 * means, and it is why it works at five players.
 *
 * @returns {string[]} role ids, shuffled
 */
export function dealRoles(count, random = Math.random) {
  if (!Number.isInteger(count) || count < MIN_PLAYERS) {
    throw new Error(`Classic mafia needs at least ${MIN_PLAYERS} players`);
  }
  if (count > MAX_PLAYERS) throw new Error(`Classic mafia tops out at ${MAX_PLAYERS} players`);
  const roles = [...CLASSIC_CORE, ...Array(count - CLASSIC_CORE.length).fill('villager')];
  return shuffle(roles, random);
}
