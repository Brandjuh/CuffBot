// Wordle service (S83 = M16.10): games keyed by guild+member (the cog's
// max_concurrency 1 per member — several officers can play at once, each
// bound to the channel they started in), per-member stats with the guess
// distribution, and the guess state machine. One recorded deviation from the
// cog: its "has lost" check hardcoded 6 — we respect maxAttempts.
import { getGuildData, updateGuildData } from '../../core/store.js';
import {
  DISTRIBUTION_SIZE,
  GUESS_TIMEOUT_MS,
  foldDiacritics,
  isGuessShaped,
} from './lib/game.js';
import { isDictionaryWord, pickWord } from './lib/words.js';

export const WORDLE_STATS_KEY = 'wordleStats';

// ── stats (the cog's member config: wins/games/guess_distribution) ───────────

const emptyStats = () => ({ players: {} });
const emptyPlayer = () => ({ wins: 0, games: 0, distribution: Array(DISTRIBUTION_SIZE).fill(0) });

/** Every finished game counts (win, loss, cancel, timeout — cog placement);
 * wins also bump the guess-distribution slot for the attempts used. */
export function recordFinished(guildId, userId, { won = false, attemptsUsed = 0 } = {}) {
  updateGuildData(
    guildId,
    WORDLE_STATS_KEY,
    (raw) => {
      const all = { ...emptyStats(), ...raw, players: { ...(raw.players ?? {}) } };
      const p = { ...emptyPlayer(), ...(all.players[userId] ?? {}) };
      p.distribution = [...p.distribution];
      p.games += 1;
      if (won) {
        p.wins += 1;
        if (attemptsUsed >= 1 && attemptsUsed <= DISTRIBUTION_SIZE) p.distribution[attemptsUsed - 1] += 1;
      }
      all.players[userId] = p;
      return all;
    },
    emptyStats(),
  );
}

export function getWordleStats(guildId, userId) {
  const raw = getGuildData(guildId, WORDLE_STATS_KEY, null);
  const p = raw?.players?.[userId];
  return { ...emptyPlayer(), ...(p ?? {}), distribution: [...(p?.distribution ?? emptyPlayer().distribution)] };
}

// ── live games ───────────────────────────────────────────────────────────────

const games = new Map(); // `${guildId}:${userId}` → game

const keyOf = (guildId, userId) => `${guildId}:${userId}`;

let seq = 0;

export function getWordleGame(guildId, userId) {
  return games.get(keyOf(guildId, userId)) ?? null;
}

export function createWordleGame(guildId, channelId, userId, { length, maxAttempts, random = Math.random }) {
  if (games.has(keyOf(guildId, userId))) return { error: 'busy' };
  const word = pickWord(random, length);
  if (!word) return { error: 'no-words' };
  seq += 1;
  const game = {
    id: `${Date.now().toString(36)}-${seq}`,
    guildId,
    channelId,
    userId,
    word,
    length,
    maxAttempts,
    attempts: [],
    won: false,
    lost: false,
    ended: false,
    message: null,
    timer: null,
  };
  games.set(keyOf(guildId, userId), game);
  return { game };
}

export function endWordleGame(game) {
  if (game.timer) clearTimeout(game.timer);
  games.delete(keyOf(game.guildId, game.userId));
}

/** The cog's 5-minute wait_for timeout — re-armed on every qualifying
 * message (valid AND invalid words both restarted its loop). */
export function armGuessTimer(game, callback, ms = GUESS_TIMEOUT_MS) {
  if (game.timer) clearTimeout(game.timer);
  game.timer = setTimeout(callback, ms);
  game.timer.unref?.();
}

/**
 * One channel message from the player — the cog's wait_for predicate + guess
 * handling as a synchronous machine. End flags flip HERE (S22 claim rule).
 * @returns {{code:'ended'|'cancel'|'ignored'|'invalid'}
 *         | {code:'accepted', won:boolean, lost:boolean}}
 */
export function submitGuess(game, content) {
  if (game.ended) return { code: 'ended' };
  const lower = content.toLowerCase();
  if (lower === 'cancel') {
    game.ended = true;
    return { code: 'cancel' };
  }
  if (!isGuessShaped(content, game.length)) return { code: 'ignored' };
  const attempt = foldDiacritics(lower);
  if (!isDictionaryWord(attempt)) return { code: 'invalid' };
  game.attempts.push(attempt);
  if (attempt === game.word) {
    game.won = true;
    game.ended = true;
  } else if (game.attempts.length >= game.maxAttempts) {
    // The cog checked `len(attempts) == 6` regardless of max_attempts — the
    // survey-mandated fix (recorded deviation).
    game.lost = true;
    game.ended = true;
  }
  return { code: 'accepted', won: game.won, lost: game.lost };
}

/** Test seam: forget all live games. */
export function clearAllWordleGames() {
  for (const game of [...games.values()]) endWordleGame(game);
}
