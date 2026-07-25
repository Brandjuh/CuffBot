// Pure rollout rules (S81 = M16.8, ported from AAA3A's rolloutgame) — no
// discord.js. Injectable `random` pins tests.
export const NUMBERS = 25; // buttons 1..25 per round
export const MAX_PLAYERS = 50;
export const MIN_PLAYERS = 2;
export const PICK_WINDOW_MS = 30_000; // per round (ends early when all picked)
export const DEFAULT_PRIZE = 2500; // the cog's CODE default (its help text lies: 5000)
export const PRIZE_MIN = 1000;
export const PRIZE_MAX = 50_000;

/** The bot's pre-rolled number for a round: a choice among non-disabled. */
export function rollNumber(random, disabled) {
  const open = [];
  for (let i = 1; i <= NUMBERS; i += 1) if (!disabled.includes(i)) open.push(i);
  return open[Math.floor(random() * open.length)];
}

/**
 * Split a round's outcome exactly like the cog: eliminated = everyone who
 * picked the rolled number PLUS everyone who picked nothing; the rest survive.
 */
export function splitEliminated(players, choices, number) {
  const timeoutEliminated = players.filter((id) => !(id in choices));
  const numberEliminated = players.filter((id) => id in choices && choices[id] === number);
  const eliminated = new Set([...timeoutEliminated, ...numberEliminated]);
  const survivors = players.filter((id) => !eliminated.has(id));
  return { timeoutEliminated, numberEliminated, survivors };
}
