// Pure hangman rules (S72 = M16.4, ported from FlameCogs/hangman) — no
// discord.js. The gallows frames and the mask format are byte-for-byte from
// the cog (incl. trailing spaces and the literal backslashes).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MAX_FAILS = 6; // the 7th frame (index 6) is the dead X-eyes frame

// prettier-ignore
export const GALLOWS = [
  '    ___    \n   |   |   \n   |   O   \n   |       \n   |       \n   |       \n   |       \n',
  '    ___    \n   |   |   \n   |   O   \n   |   |   \n   |   |   \n   |       \n   |       \n',
  '    ___    \n   |   |   \n   |   O   \n   |  \\|  \n   |   |   \n   |       \n   |       \n',
  '    ___    \n   |   |   \n   |   O   \n   |  \\|/ \n   |   |   \n   |       \n   |       \n',
  '    ___    \n   |   |   \n   |   O   \n   |  \\|/ \n   |   |   \n   |  /    \n   |       \n',
  '    ___    \n   |   |   \n   |   O   \n   |  \\|/ \n   |   |   \n   |  / \\ \n   |       \n',
  '    ___    \n   |   |   \n   |   X   \n   |  \\|/ \n   |   |   \n   |  / \\ \n   |       \n',
];

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';

/** The cog's `_get_message`: masked word + the incorrect letters in (). */
export function maskWord(word, guessed) {
  let p = '';
  for (const l of word) {
    if (!LETTERS.includes(l)) p += `${l} `; // auto print non letter characters
    else if (guessed.includes(l)) p += `${l} `;
    else p += '_ ';
  }
  p += '    (';
  for (const l of guessed) {
    if (!word.includes(l)) p += l; // the incorrect guessed letters
  }
  p += ')';
  return p;
}

/** Every a–z letter of the word has been guessed (the cog's set arithmetic). */
export function isWon(word, guessed) {
  return [...word].every((l) => !LETTERS.includes(l) || guessed.includes(l));
}

export function isLetter(content) {
  return typeof content === 'string' && content.length === 1 && LETTERS.includes(content.toLowerCase());
}

/**
 * Apply one guessed letter to a game state ({ word, guessed, fails }).
 * Mutates the state, cog-faithfully: repeats are free, the 6th wrong guess
 * loses, a completed word wins.
 * @returns {'repeat'|'won'|'lost'|'wrong'|'good'}
 */
export function applyGuess(state, rawLetter) {
  const letter = rawLetter.toLowerCase();
  if (state.guessed.includes(letter)) return 'repeat';
  state.guessed += letter;
  if (!state.word.includes(letter)) {
    state.fails += 1;
    if (state.fails === MAX_FAILS) return 'lost';
    return 'wrong';
  }
  return isWon(state.word, state.guessed) ? 'won' : 'good';
}

/** The board text exactly as the cog rendered it. */
export function renderBoard(state, { repeat = false, outcome = null } = {}) {
  let p = `\`\`\`${GALLOWS[state.fails]}\n${maskWord(state.word, state.guessed)}\`\`\``;
  if (outcome === 'won') return `${p}You win!\nThe word was ${state.word}.`;
  if (outcome === 'lost') return `${p}Game Over\nThe word was ${state.word}.`;
  if (repeat) p += 'You already guessed that letter.\n';
  return `${p}Guess:`;
}

const wordsFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'words.txt');

let wordsCache = null;

/** The bundled 4,554-word list (FlameCogs verbatim), lowercased and trimmed. */
export function loadWords({ file = wordsFile, force = false } = {}) {
  if (wordsCache && !force) return wordsCache;
  wordsCache = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean);
  return wordsCache;
}

/** Pick a random word (injectable RNG for tests). */
export function pickWord(random = Math.random, words = loadWords()) {
  return words[Math.floor(random() * words.length)];
}
