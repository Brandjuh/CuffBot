// Pure russian-roulette rules (S73 = M16.5, ported from AAA3A's
// russianroulettegame) — no discord.js. Every random draw takes an injectable
// `random` so tests pin outcomes.
export const MAX_PLAYERS = 30;
export const MIN_PLAYERS = 2;
export const MISFIRE_CHANCE = 0.1; // random() < 0.1 → the shot goes the wrong way

/** Fisher–Yates on a copy; consumes len-1 draws. */
export function shufflePlayers(random, players) {
  const order = [...players];
  for (let i = order.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** The chamber index for this round (the cog's randint(0, len-1)). */
export function rollBullet(random, playerCount) {
  return Math.floor(random() * playerCount);
}

/** At the bullet: true = self-death (90%), false = misfire (10%). */
export function rollSelfDeath(random) {
  return random() >= MISFIRE_CHANCE;
}

/** The misfire victim: a random OTHER living player. */
export function pickMisfireVictim(random, alive, shooterId) {
  const others = alive.filter((id) => id !== shooterId);
  return others[Math.floor(random() * others.length)];
}
