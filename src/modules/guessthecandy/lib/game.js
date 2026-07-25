// Pure guess-the-candy rules (S80 = M16.7, ported from AAA3A's
// guessthecandygame) — no discord.js. The cog's 23-candy pool ports verbatim
// (names only); the branded shadow PNGs deliberately do NOT (recorded
// deviation: MIT on the repo cannot license product imagery) — the obscured
// prompt is a per-word letter scramble instead.
export const CANDIES = [
  'Air Heads',
  'Almond Joy',
  'Berries & Cream',
  'Candy',
  'Candy Cane',
  'Candy Corn',
  'Chupa Chups Lollipops',
  'Dots',
  'Ferrero',
  'Gummy Bears',
  "Hershey's Chocolate",
  'Jolly Rancher',
  'Kinder Joy',
  'Kisses',
  'KitKat',
  'M&Ms',
  "Reese's",
  'Skittles',
  'Snickers',
  'Sour Patch',
  'Starburst',
  'Sugar Skull',
  'Twizzlers',
];

export const MIN_DIFFICULTY = 5;
export const MAX_DIFFICULTY = CANDIES.length; // 23, like the cog
export const DEFAULT_DIFFICULTY = 5;
export const GAME_TIMEOUT_MS = 180_000; // the cog's view timeout

/** Python random.sample equivalent: k distinct picks, input untouched. */
export function sampleCandies(random, k, pool = CANDIES) {
  const copy = [...pool];
  const picked = [];
  for (let i = 0; i < k; i += 1) {
    const index = Math.floor(random() * copy.length);
    picked.push(copy.splice(index, 1)[0]);
  }
  return picked;
}

/** The answer is always among the buttons (the cog's sample-then-choice). */
export function pickAnswer(random, sampled) {
  return sampled[Math.floor(random() * sampled.length)];
}

/**
 * Scramble a candy name per word (word boundaries and punctuation stay in
 * place, letters shuffle). Reshuffles until the result differs from the
 * input (single-letter words can't change — the word stays).
 */
export function scrambleName(random, name) {
  const scrambleWord = (word) => {
    if (word.length < 2) return word;
    const chars = [...word];
    for (let attempt = 0; attempt < 10; attempt += 1) {
      for (let i = chars.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [chars[i], chars[j]] = [chars[j], chars[i]];
      }
      const result = chars.join('');
      if (result !== word) return result;
    }
    return chars.join('');
  };
  return name
    .split(' ')
    .map((word) => scrambleWord(word))
    .join(' ');
}

/** The cog's win line shows seconds with two decimals. */
export function formatElapsed(ms) {
  return (ms / 1000).toFixed(2);
}
