// Memory pure rules (S82 = M16.9, ported from AAA3A-cogs/memorygame):
// board layouts and the exact decayed-prize formula. No discord.js imports.

// The cog's emoji pool, verbatim (12 — enough for the 5x5 board's 12 pairs).
export const GAME_EMOJIS = ['🏆', '🎯', '🎲', '⚽', '🏀', '🏓', '🥁', '🎮', '🎳', '🎻', '🎖️', '🏹'];

export const DIFFICULTIES = ['3x3', '4x4', '5x5'];
export const DEFAULT_DIFFICULTY = '5x5';

// The cog's invisible filler for the odd center tile (3x3 and 5x5 boards).
export const BLANK = '\u200c';

// Config bounds (the cog's converter ranges) and defaults.
export const MAX_WRONG_MIN = 0; // 0 = no limit (the cog's own convention)
export const MAX_WRONG_MAX = 50;
export const PRIZE_MIN = 1000;
export const PRIZE_MAX = 50_000;
export const REDUCTION_MIN = 0;
export const REDUCTION_MAX = 30;
export const DEFAULT_MAX_PRIZE = 5000;
export const DEFAULT_REDUCTION_PER_SECOND = 5;
export const DEFAULT_REDUCTION_PER_WRONG = 15;

export const IDLE_TIMEOUT_MS = 10 * 60_000; // the cog's View timeout
export const MISMATCH_FLASH_MS = 1000; // red flash before re-hiding a bad pair

/** Board side length for a difficulty. */
export function gridSize(difficulty) {
  return Number(difficulty[0]);
}

/** Pairs on the board: 3x3 → 4, 4x4 → 8, 5x5 → 12 (the cog's layouts). */
export function pairCount(difficulty) {
  return { '3x3': 4, '4x4': 8, '5x5': 12 }[difficulty];
}

function shuffleInPlace(random, array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

/**
 * The flat tile list for one game, mirroring the cog's get_emojis: a shuffled
 * emoji sample duplicated into pairs, with BLANK inserted at the center on the
 * odd-sized boards (index 4 on 3x3, index 12 on 5x5).
 * @returns {string[]} length 9/16/25 — emojis plus at most one BLANK
 */
export function buildTiles(random, difficulty) {
  const pool = shuffleInPlace(random, [...GAME_EMOJIS]).slice(0, pairCount(difficulty));
  const tiles = shuffleInPlace(random, [...pool, ...pool]);
  if (difficulty === '3x3') tiles.splice(4, 0, BLANK);
  if (difficulty === '5x5') tiles.splice(12, 0, BLANK);
  return tiles;
}

/**
 * The cog's exact prize: base = maxPrize scaled 1/3 (3x3) or 2/3 (4x4) with
 * Python int() truncation — int(maxPrize / 3 * 2), NOT floor(maxPrize/3)*2 —
 * then max(int((base − seconds·perSecond − wrong·perWrong) · (n/5)), 0).
 */
export function computePrize({
  difficulty,
  seconds,
  wrongMatches,
  maxPrize,
  reductionPerSecond,
  reductionPerWrongMatch,
}) {
  let base = maxPrize;
  if (difficulty === '3x3') base = Math.trunc(maxPrize / 3);
  else if (difficulty === '4x4') base = Math.trunc((maxPrize / 3) * 2);
  const n = gridSize(difficulty);
  return Math.max(
    Math.trunc((base - seconds * reductionPerSecond - wrongMatches * reductionPerWrongMatch) * (n / 5)),
    0,
  );
}
