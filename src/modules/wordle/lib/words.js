// Wordle word lists (S83): the cog's EN answer list (7,543) and EN dictionary
// (219,855) ship verbatim in data/ — every entry is already 4–11 letters.
// Loaded once, indexed by length; entries are diacritic-folded (the cog left
// `jalapeño` unguessable — folded lists keep every secret typeable) and the
// literal word "cancel" is skipped (the cog's quit keyword, same skip).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LENGTH_MAX, LENGTH_MIN, foldDiacritics } from './game.js';

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');

let cache = null;

function parseList(file) {
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((raw) => foldDiacritics(raw.trim().toLowerCase()))
    .filter((word) => word && word !== 'cancel');
}

/** @returns {{ words: Map<number, string[]>, dictionary: Map<number, Set<string>> }} */
export function loadWordLists() {
  if (cache) return cache;
  const words = new Map();
  const dictionary = new Map();
  for (let length = LENGTH_MIN; length <= LENGTH_MAX; length += 1) {
    words.set(length, []);
    dictionary.set(length, new Set());
  }
  for (const word of parseList(path.join(dataDir, 'words-en.txt'))) {
    words.get(word.length)?.push(word);
    dictionary.get(word.length)?.add(word); // every answer is always a valid guess
  }
  for (const word of parseList(path.join(dataDir, 'dictionary-en.txt'))) {
    dictionary.get(word.length)?.add(word);
  }
  cache = { words, dictionary };
  return cache;
}

/** A random secret of the given length, or null when the list is empty. */
export function pickWord(random, length) {
  const pool = loadWordLists().words.get(length) ?? [];
  if (pool.length === 0) return null;
  return pool[Math.floor(random() * pool.length)];
}

/** Is this (already folded) attempt a real word of its length? */
export function isDictionaryWord(attempt) {
  return loadWordLists().dictionary.get(attempt.length)?.has(attempt) ?? false;
}
