// Heist narration (S86 = M16.12 slice B): the cog's flavour lines, verbatim
// (meta.py). Crew lines are carried for slice D. Pure — pick with any rng.
export const FLAVOUR_SUCCESS = [
  'You moved like a ghost - in and out before anyone noticed.',
  'Textbook execution. The crew would be proud.',
  'Clean hands, full pockets. Another day, another score.',
  'No alarms. No witnesses. Just profit.',
  'Like taking candy from a baby - if the baby had a vault.',
  'You vanished into the night with exactly what you came for.',
  'The plan worked perfectly. It never does, but this time it did.',
];

export const FLAVOUR_FAIL = [
  'Something went wrong. It always does eventually.',
  'The mark was smarter than expected.',
  "Bad luck. The kind you can't plan around.",
  'You got out, but not with what you came for.',
  "Sloppy execution. You'll do better next time.",
  "The score wasn't worth the heat you brought down.",
  'Close, but close only counts in horseshoes.',
];

export const FLAVOUR_CAUGHT = [
  'Red and blue lights filled the rear-view mirror.',
  'Sirens. Always the sirens.',
  'Someone talked. Or maybe you just got unlucky.',
  'The long arm of the law finally caught up.',
  'Cuffs clicked. Game over - for now.',
  'You froze at the wrong moment.',
];

export const FLAVOUR_SHIELD = [
  "Your armour took the hit so you didn't have to.",
  'The shield held. Barely.',
  'Damage mitigated. Gear degraded.',
];

export const FLAVOUR_TOOL = [
  'Your equipment gave you the edge you needed.',
  'Proper tools make proper criminals.',
  'The gear performed exactly as advertised.',
];

export const FLAVOUR_MATERIAL = [
  'You pocketed some useful scraps on the way out.',
  'A bonus find among the chaos.',
  'Salvaged something valuable from the wreckage.',
];

export const CREW_FLAVOUR_SUCCESS = [
  'The crew moved as one. Nobody left empty-handed.',
  'Four minds, one plan. It worked like clockwork.',
  'In and out. The perfect score.',
  'Coordination is everything - and yours was flawless.',
];

export const CREW_FLAVOUR_FAIL = [
  'Someone broke formation. The whole crew paid for it.',
  'The job fell apart. Happens to the best of them.',
  'Too many moving parts. Something had to go wrong.',
  'The plan looked good on paper.',
];

export const CREW_FLAVOUR_CAUGHT = [
  "A whole crew in cuffs. Someone's going to write a book about this.",
  'You almost made it. Almost.',
  'Four sets of hands - and every one of them caught.',
  'The police were waiting. Someone talked.',
];

/** The narration for one outcome (caught beats success beats failure). */
export function narrate({ success, caught }, random = Math.random) {
  const pool = caught ? FLAVOUR_CAUGHT : success ? FLAVOUR_SUCCESS : FLAVOUR_FAIL;
  return pool[Math.floor(random() * pool.length)];
}

/** The cog's heat bar (20 dots, 20 heat = full). */
export function heatBar(heat, maxHeat = 20, length = 20) {
  const filled = Math.min(Math.round((heat / maxHeat) * length), length);
  const pct = Math.min((heat / maxHeat) * 100, 100);
  return `\`${'●'.repeat(filled)}${'○'.repeat(length - filled)}\` ${pct.toFixed(0)}%`;
}
