// Hangman service (S72 = M16.4): one RAM game per channel (restart = the game
// simply ends, nothing persists — the cog keeps no stats either) + the one
// per-guild setting the cog had: doEdit (single edited board vs new messages).
import { getGuildData, setGuildData } from '../../core/store.js';
import { pickWord } from './lib/game.js';

export const HANGMAN_CONFIG_KEY = 'hangmanConfig';
export const GUESS_TIMEOUT_MS = 60_000; // per guess, cog-faithful

export const DEFAULT_HANGMAN_CONFIG = { doEdit: true };

export function getHangmanConfig(guildId) {
  return { ...DEFAULT_HANGMAN_CONFIG, ...getGuildData(guildId, HANGMAN_CONFIG_KEY, {}) };
}

export function setHangmanConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, HANGMAN_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, HANGMAN_CONFIG_KEY, stored);
  return { ...DEFAULT_HANGMAN_CONFIG, ...stored };
}

const games = new Map(); // channelId → game

export function getHangmanGame(channelId) {
  return games.get(channelId) ?? null;
}

/**
 * Start a game for one player in a channel.
 * @returns {{game}|{error:'busy'}}
 */
export function startHangman(channelId, guildId, playerId, { random } = {}) {
  if (games.has(channelId)) return { error: 'busy' };
  const game = {
    channelId,
    guildId,
    playerId,
    word: pickWord(random),
    guessed: '',
    fails: 0,
    boardMessage: null, // filled in by the command
    timer: null,
  };
  games.set(channelId, game);
  return { game };
}

export function endHangman(channelId) {
  const game = games.get(channelId);
  if (game?.timer) clearTimeout(game.timer);
  games.delete(channelId);
  return game ?? null;
}

/** (Re-)arm the 60 s per-guess timer; the callback owns the Discord side. */
export function armGuessTimer(game, callback, ms = GUESS_TIMEOUT_MS) {
  if (game.timer) clearTimeout(game.timer);
  game.timer = setTimeout(callback, ms);
  game.timer.unref?.();
}

/** Test seam: forget all live games. */
export function clearAllHangmanGames() {
  for (const channelId of [...games.keys()]) endHangman(channelId);
}
