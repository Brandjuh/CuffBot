// Wordle pure rules (S83 = M16.10, ported from AAA3A-cogs/wordlegame): the
// cog's NAIVE coloring rule copied exactly, diacritic folding, and the emoji
// grid that replaces its Pillow rendering. No discord.js imports.

export const LENGTH_MIN = 4;
export const LENGTH_MAX = 11;
export const DEFAULT_LENGTH = 5;
export const ATTEMPTS_MIN = 5;
export const ATTEMPTS_MAX = 10;
export const DEFAULT_ATTEMPTS = 6;
export const GUESS_TIMEOUT_MS = 5 * 60_000; // the cog's per-guess wait_for timeout
export const DISTRIBUTION_SIZE = 10; // guess_distribution slots (attempts cap)

// The cog's DIACRITIC_SYMBOLS, inverted to a fold map (guesses AND our lists).
const DIACRITICS = {
  a: 'àáâãäå',
  c: 'ç',
  e: 'èéêë',
  i: 'ìíîï',
  n: 'ñ',
  o: 'òóôõö',
  u: 'ùúûü',
  y: 'ýÿ',
};
const FOLD = new Map();
for (const [base, variants] of Object.entries(DIACRITICS)) {
  for (const variant of variants) FOLD.set(variant, base);
}

/** à→a, ñ→n, … (the cog folds guesses; we also fold list entries at load). */
export function foldDiacritics(text) {
  return [...text].map((ch) => FOLD.get(ch) ?? ch).join('');
}

/** The cog's wait_for predicate shape: exactly `length` letters (unicode
 * letters count, like Python isalpha — folding happens after). */
export function isGuessShaped(content, length) {
  return content.length === length && /^\p{L}+$/u.test(content);
}

/**
 * One attempt row's colors — the cog's rule VERBATIM, including its naive
 * yellow: a letter is yellow when it matches the word at ANY non-green
 * position, with no duplicate-letter counting (so `eexit` vs `crane` shows
 * TWO yellow e's where classic Wordle shows one). Survey mandate: copy, not
 * fix.
 * @returns {('green'|'yellow'|'grey')[]}
 */
export function colorRow(word, attempt) {
  const length = word.length;
  const colors = [];
  for (let j = 0; j < length; j += 1) {
    const letter = attempt[j];
    if (letter === word[j]) {
      colors.push('green');
      continue;
    }
    let yellow = false;
    for (let k = 0; k < length; k += 1) {
      if (letter === word[k] && attempt[k] !== word[k]) {
        yellow = true;
        break;
      }
    }
    colors.push(yellow ? 'yellow' : 'grey');
  }
  return colors;
}

const SQUARES = { green: '🟩', yellow: '🟨', grey: '⬛' };

/** The board: one line per played attempt (squares + the word), empty ⬜ rows
 * for the attempts left — the emoji stand-in for the cog's PNG grid. */
export function renderGrid(word, attempts, maxAttempts) {
  const lines = attempts.map(
    (attempt) => `${colorRow(word, attempt).map((c) => SQUARES[c]).join('')} \`${attempt.toUpperCase()}\``,
  );
  for (let i = attempts.length; i < maxAttempts; i += 1) lines.push('⬜'.repeat(word.length));
  return lines.join('\n');
}
