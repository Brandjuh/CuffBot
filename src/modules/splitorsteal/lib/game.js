// Pure split-or-steal rules (S79 = M16.6, ported from AAA3A's
// splitorstealgame) — no discord.js. Injectable `random` pins tests.
export const JOIN_WINDOW_MS = 60_000; // fixed join window (never ends early)
export const CHOOSE_WINDOW_MS = 60_000; // both players' secret-choice window

/**
 * Draw the two contestants exactly like the cog: random.choice, remove,
 * random.choice again. Returns [playerA, playerB]; input untouched.
 */
export function pickTwoPlayers(random, joiners) {
  const pool = [...joiners];
  const a = pool[Math.floor(random() * pool.length)];
  pool.splice(pool.indexOf(a), 1);
  const b = pool[Math.floor(random() * pool.length)];
  return [a, b];
}

/**
 * The classic matrix.
 * @returns {'both-win'|'both-lose'|'a-steals'|'b-steals'}
 */
export function resolveSos(choiceA, choiceB) {
  if (choiceA === 'split' && choiceB === 'split') return 'both-win';
  if (choiceA === 'steal' && choiceB === 'steal') return 'both-lose';
  return choiceA === 'steal' ? 'a-steals' : 'b-steals';
}
