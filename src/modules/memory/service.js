// Memory service (S82 = M16.9): single-player pair matching. Games are keyed
// by GAME id (the cog allows parallel boards — each lives on its own message),
// stats/config persist like rollout's. One recorded deviation from the cog:
// its lose() incremented `games` a SECOND time (already counted at start) —
// we count once.
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import {
  BLANK,
  DEFAULT_DIFFICULTY,
  DEFAULT_MAX_PRIZE,
  DEFAULT_REDUCTION_PER_SECOND,
  DEFAULT_REDUCTION_PER_WRONG,
  IDLE_TIMEOUT_MS,
  buildTiles,
  computePrize,
  pairCount,
} from './lib/game.js';

export const MEMORY_CONFIG_KEY = 'memoryConfig';
export const MEMORY_STATS_KEY = 'memoryStats';

// maxWrongMatches 0 = no limit (the cog's None default, using its own "0 for
// no limit" converter convention); economy mirrors red_economy.
export const DEFAULT_MEMORY_CONFIG = {
  maxWrongMatches: 0,
  economy: false,
  maxPrize: DEFAULT_MAX_PRIZE,
  reductionPerSecond: DEFAULT_REDUCTION_PER_SECOND,
  reductionPerWrongMatch: DEFAULT_REDUCTION_PER_WRONG,
};

export function getMemoryConfig(guildId) {
  return { ...DEFAULT_MEMORY_CONFIG, ...getGuildData(guildId, MEMORY_CONFIG_KEY, {}) };
}

export function setMemoryConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, MEMORY_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, MEMORY_CONFIG_KEY, stored);
  return { ...DEFAULT_MEMORY_CONFIG, ...stored };
}

// ── stats (score/wins/games, the cog's member config) ────────────────────────

const emptyStats = () => ({ players: {} });
const playerStats = (all, id) => all.players[id] ?? { score: 0, wins: 0, games: 0 };

/** games += 1 at game START (the cog's placement — and the ONLY increment;
 * its extra +1 inside lose() is the double-count bug we do not port). */
export function recordGamePlayed(guildId, userId) {
  updateGuildData(
    guildId,
    MEMORY_STATS_KEY,
    (raw) => {
      const all = { ...emptyStats(), ...raw, players: { ...(raw.players ?? {}) } };
      const p = playerStats(all, userId);
      all.players[userId] = { ...p, games: p.games + 1 };
      return all;
    },
    emptyStats(),
  );
}

export function recordWin(guildId, userId, prize) {
  updateGuildData(
    guildId,
    MEMORY_STATS_KEY,
    (raw) => {
      const all = { ...emptyStats(), ...raw, players: { ...(raw.players ?? {}) } };
      const p = playerStats(all, userId);
      all.players[userId] = { ...p, score: p.score + prize, wins: p.wins + 1 };
      return all;
    },
    emptyStats(),
  );
}

export function getMemoryStats(guildId) {
  const raw = getGuildData(guildId, MEMORY_STATS_KEY, null);
  return { ...emptyStats(), ...(raw ?? {}), players: { ...(raw?.players ?? {}) } };
}

export function topMemory(guildId) {
  return Object.entries(getMemoryStats(guildId).players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.score - a.score);
}

export function resetMemoryStats(guildId) {
  setGuildData(guildId, MEMORY_STATS_KEY, emptyStats());
}

// ── live games ───────────────────────────────────────────────────────────────

const games = new Map(); // gameId → game

let seq = 0;

export function getMemoryGame(gameId) {
  return games.get(gameId) ?? null;
}

export function createMemoryGame(
  channelId,
  guildId,
  playerId,
  { difficulty = DEFAULT_DIFFICULTY, random = Math.random, now = () => Date.now() } = {},
) {
  seq += 1;
  const game = {
    id: `${Date.now().toString(36)}-${seq}`,
    channelId,
    guildId,
    playerId,
    difficulty,
    tiles: buildTiles(random, difficulty),
    found: [], // matched emojis
    selected: null, // tile index of the first pick, or null
    tries: 0,
    wrongMatches: 0,
    maxWrongMatches: getMemoryConfig(guildId).maxWrongMatches,
    startedAt: null, // stamped after the board message is sent (cog behavior)
    endedAt: null,
    ended: false,
    locked: false, // true while a mismatch flash is being shown
    now,
    message: null,
    timer: null,
  };
  games.set(game.id, game);
  return game;
}

/** The cog stamps its clock only after the board message went out. */
export function markStarted(game) {
  game.startedAt = game.now();
}

export function endMemoryGame(gameId) {
  const game = games.get(gameId);
  if (game?.timer) clearTimeout(game.timer);
  games.delete(gameId);
  return game ?? null;
}

/** The cog's 10-minute idle View timeout; re-arm on every press. */
export function armIdleTimer(game, callback, ms = IDLE_TIMEOUT_MS) {
  if (game.timer) clearTimeout(game.timer);
  game.timer = setTimeout(callback, ms);
  game.timer.unref?.();
}

/** The pump calls this after the mismatch flash finished rendering. */
export function unlockMemoryGame(game) {
  game.locked = false;
}

/**
 * One tile press — the cog's callback as a synchronous state machine. Ended
 * flags flip HERE, before any await (the S22 claim rule). Clicking the same
 * tile twice counts as a try AND a wrong match (cog quirk, ported).
 * @returns {{code:'ended'|'busy'|'ignored'|'selected'}
 *         | {code:'mismatch'|'lost'|'match'|'won', first:number, second:number}}
 */
export function pressTile(game, tileIndex) {
  if (game.ended) return { code: 'ended' };
  if (game.locked) return { code: 'busy' };
  const emoji = game.tiles[tileIndex];
  if (!emoji || emoji === BLANK || game.found.includes(emoji)) return { code: 'ignored' };
  if (game.selected === null) {
    game.selected = tileIndex;
    return { code: 'selected' };
  }
  const first = game.selected;
  const second = tileIndex;
  game.selected = null;
  game.tries += 1;
  if (first === second || game.tiles[first] !== emoji) {
    game.wrongMatches += 1;
    game.locked = true;
    if (game.maxWrongMatches && game.wrongMatches >= game.maxWrongMatches) {
      game.ended = true;
      game.endedAt = game.now();
      return { code: 'lost', first, second };
    }
    return { code: 'mismatch', first, second };
  }
  game.found.push(emoji);
  if (game.found.length === pairCount(game.difficulty)) {
    game.ended = true;
    game.endedAt = game.now();
    return { code: 'won', first, second };
  }
  return { code: 'match', first, second };
}

/**
 * Settle a won game: the cog's exact decayed prize goes on the scoreboard,
 * and — with the economy toggle on — the same amount is paid in donuts via
 * the adjustBalance seam (S8 rule: a broken auxiliary module degrades to
 * scoreboard-only, never blocks).
 * @returns {Promise<{seconds:number, tries:number, wrongMatches:number, prize:number, paid:boolean}>}
 */
export async function finishWin(game) {
  const seconds = Math.trunc((game.endedAt - game.startedAt) / 1000);
  if (game.tries === 0) game.tries = game.found.length; // cog defensiveness, kept
  const config = getMemoryConfig(game.guildId);
  const prize = computePrize({
    difficulty: game.difficulty,
    seconds,
    wrongMatches: game.wrongMatches,
    maxPrize: config.maxPrize,
    reductionPerSecond: config.reductionPerSecond,
    reductionPerWrongMatch: config.reductionPerWrongMatch,
  });
  recordWin(game.guildId, game.playerId, prize);
  let paid = false;
  if (config.economy) {
    try {
      const { adjustBalance } = await import('../economy/service.js');
      adjustBalance(game.guildId, game.playerId, prize);
      paid = true;
    } catch (error) {
      logger.warn('Memory: economy payout failed:', error?.message ?? error);
    }
  }
  return { seconds, tries: game.tries, wrongMatches: game.wrongMatches, prize, paid };
}

/** Test seam: forget all live games. */
export function clearAllMemoryGames() {
  for (const gameId of [...games.keys()]) endMemoryGame(gameId);
}
