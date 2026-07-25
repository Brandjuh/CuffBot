// Guess-the-candy service (S80 = M16.7): rounds keyed by GAME id (the cog
// allows parallel rounds — each lives on its own message, so unlike the
// channel-locked games this one never blocks a channel). RAM-only, no stats
// (the cog keeps none).
import {
  DEFAULT_DIFFICULTY,
  GAME_TIMEOUT_MS,
  pickAnswer,
  sampleCandies,
  scrambleName,
} from './lib/game.js';

const games = new Map(); // gameId → game

let seq = 0;

export function getCandyGame(gameId) {
  return games.get(gameId) ?? null;
}

export function createCandyGame(channelId, guildId, { difficulty = DEFAULT_DIFFICULTY, random = Math.random } = {}) {
  seq += 1;
  const candies = sampleCandies(random, difficulty);
  const answer = pickAnswer(random, candies);
  const game = {
    id: `${Date.now().toString(36)}-${seq}`,
    channelId,
    guildId,
    candies,
    answer,
    scrambled: scrambleName(random, answer),
    startedAt: null, // stamped after the message is sent (cog behavior)
    ended: false,
    message: null,
    timer: null,
  };
  games.set(game.id, game);
  return game;
}

export function endCandyGame(gameId) {
  const game = games.get(gameId);
  if (game?.timer) clearTimeout(game.timer);
  games.delete(gameId);
  return game ?? null;
}

/** Arm the cog's 180 s round timeout; the callback owns the Discord side. */
export function armCandyTimer(game, callback, ms = GAME_TIMEOUT_MS) {
  if (game.timer) clearTimeout(game.timer);
  game.timer = setTimeout(callback, ms);
  game.timer.unref?.();
}

/**
 * One button press. The ended flag flips SYNCHRONOUSLY on the winning press
 * (the cog's asyncio.Lock; our claim-before-send rule, S22) so a double win
 * is impossible.
 * @returns {'won'|'wrong'|'ended'}
 */
export function pressCandy(game, guess) {
  if (game.ended) return 'ended';
  if (guess !== game.answer) return 'wrong';
  game.ended = true;
  return 'won';
}

/** Test seam: forget all live rounds. */
export function clearAllCandyGames() {
  for (const gameId of [...games.keys()]) endCandyGame(gameId);
}
