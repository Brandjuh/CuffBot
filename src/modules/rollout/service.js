// Rollout service (S81 = M16.8): the lobby, the pick bridge, persistent
// stats/config, and the io-driven game runner (third consumer of the S73
// engine pattern). The cog's edge cases port faithfully — including the ONE
// it crashed on: 24 disabled numbers with >1 player alive is a TIE here
// (the cog's tie embed was unreachable: it dereferenced a None winner first).
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import {
  DEFAULT_PRIZE,
  MAX_PLAYERS,
  NUMBERS,
  PICK_WINDOW_MS,
  rollNumber,
  splitEliminated,
} from './lib/game.js';

export const ROLLOUT_CONFIG_KEY = 'rolloutConfig';
export const ROLLOUT_STATS_KEY = 'rolloutStats';

// economy=false mirrors the cog's red_economy default; when on, the winner's
// prize is paid in donuts through the economy seam (adjustBalance).
export const DEFAULT_ROLLOUT_CONFIG = { prize: DEFAULT_PRIZE, economy: false };

export function getRolloutConfig(guildId) {
  return { ...DEFAULT_ROLLOUT_CONFIG, ...getGuildData(guildId, ROLLOUT_CONFIG_KEY, {}) };
}

export function setRolloutConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, ROLLOUT_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, ROLLOUT_CONFIG_KEY, stored);
  return { ...DEFAULT_ROLLOUT_CONFIG, ...stored };
}

// ── stats (score/wins/games, the cog's member config) ────────────────────────

const emptyStats = () => ({ players: {} });
const playerStats = (all, id) => all.players[id] ?? { score: 0, wins: 0, games: 0 };

export function recordGamesPlayed(guildId, playerIds) {
  updateGuildData(
    guildId,
    ROLLOUT_STATS_KEY,
    (raw) => {
      const all = { ...emptyStats(), ...raw, players: { ...(raw.players ?? {}) } };
      for (const id of playerIds) {
        const p = playerStats(all, id);
        all.players[id] = { ...p, games: p.games + 1 };
      }
      return all;
    },
    emptyStats(),
  );
}

export function recordWin(guildId, winnerId, prize) {
  updateGuildData(
    guildId,
    ROLLOUT_STATS_KEY,
    (raw) => {
      const all = { ...emptyStats(), ...raw, players: { ...(raw.players ?? {}) } };
      const p = playerStats(all, winnerId);
      all.players[winnerId] = { ...p, score: p.score + prize, wins: p.wins + 1 };
      return all;
    },
    emptyStats(),
  );
}

export function getRolloutStats(guildId) {
  const raw = getGuildData(guildId, ROLLOUT_STATS_KEY, null);
  return { ...emptyStats(), ...(raw ?? {}), players: { ...(raw?.players ?? {}) } };
}

export function topRollout(guildId) {
  return Object.entries(getRolloutStats(guildId).players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.score - a.score);
}

export function resetRolloutStats(guildId) {
  setGuildData(guildId, ROLLOUT_STATS_KEY, emptyStats());
}

// ── live games ───────────────────────────────────────────────────────────────

const games = new Map(); // channelId → game

let seq = 0;

export function getRolloutGame(channelId) {
  return games.get(channelId) ?? null;
}

export function createRolloutLobby(channelId, guildId, hostId) {
  if (games.has(channelId)) return { error: 'busy' };
  seq += 1;
  const game = {
    id: `${Date.now().toString(36)}-${seq}`,
    channelId,
    guildId,
    hostId,
    players: [hostId], // host auto-joins (cog behavior)
    state: 'lobby', // lobby → running
    lobbyMessage: null,
    roundPlayers: [],
    roundChoices: {},
    onAllPicked: null,
  };
  games.set(channelId, game);
  return { game };
}

export function joinRollout(game, userId) {
  if (game.players.includes(userId)) return 'already';
  if (game.players.length >= MAX_PLAYERS) return 'full';
  game.players.push(userId);
  return 'joined';
}

export function leaveRollout(game, userId) {
  const index = game.players.indexOf(userId);
  if (index === -1) return 'not-joined';
  game.players.splice(index, 1);
  return 'left';
}

export function endRolloutGame(channelId) {
  games.delete(channelId);
}

/**
 * A number press during a round.
 * @returns {{code:'recorded'}|{code:'not-player'|'already'|'closed'}}
 */
export function pickNumber(game, userId, number) {
  if (game.state !== 'running') return { code: 'closed' };
  if (!game.roundPlayers.includes(userId)) return { code: 'not-player' };
  if (userId in game.roundChoices) return { code: 'already' };
  game.roundChoices[userId] = number;
  if (game.roundPlayers.every((id) => id in game.roundChoices) && game.onAllPicked) game.onAllPicked();
  return { code: 'recorded' };
}

/** Resolves 'all' when every alive player picked, 'timeout' otherwise. */
function awaitPicks(game, timeoutMs) {
  return new Promise((resolve) => {
    if (game.roundPlayers.every((id) => id in game.roundChoices)) {
      resolve('all');
      return;
    }
    const timer = setTimeout(() => {
      game.onAllPicked = null;
      resolve('timeout');
    }, timeoutMs);
    timer.unref?.();
    game.onAllPicked = () => {
      clearTimeout(timer);
      game.onAllPicked = null;
      resolve('all');
    };
  });
}

/** The winner's prize, paid through the economy seam when enabled (S8 rule:
 * a broken auxiliary module degrades, never blocks). */
async function awardPrize(guildId, winnerId) {
  const config = getRolloutConfig(guildId);
  recordWin(guildId, winnerId, config.prize);
  if (!config.economy) return { prize: config.prize, paid: false };
  try {
    const { adjustBalance } = await import('../economy/service.js');
    adjustBalance(guildId, winnerId, config.prize);
    return { prize: config.prize, paid: true };
  } catch (error) {
    logger.warn('Rollout: economy payout failed:', error?.message ?? error);
    return { prize: config.prize, paid: false };
  }
}

/**
 * The whole game (the cog's command body). `io`: { openRound(round, alive,
 * disabled, endsAtMs), revealNumber(number), nobodyAnswered(), roundRestart
 * (number), results(round, number, numberEliminated, timeoutEliminated,
 * survivors), tie(), winner(winnerId, prize, paid), sleep? } — production
 * wires embeds/buttons; tests script it.
 */
export async function runRolloutGame(
  game,
  io,
  { random = Math.random, pickMs = PICK_WINDOW_MS, now = () => Date.now() } = {},
) {
  game.state = 'running';
  recordGamesPlayed(game.guildId, game.players);
  let players = [...game.players];
  const disabled = [];
  let round = 0;
  try {
    while (players.length > 1) {
      // The cog broke out here and then CRASHED on the None winner — we tie.
      if (disabled.length === NUMBERS - 1) {
        await io.tie();
        return { outcome: 'tie', rounds: round };
      }
      round += 1;
      const number = rollNumber(random, disabled);
      game.roundPlayers = players;
      game.roundChoices = {};
      await io.openRound(round, players, [...disabled], now() + pickMs);
      await awaitPicks(game, pickMs);
      const { timeoutEliminated, numberEliminated, survivors } = splitEliminated(
        players,
        game.roundChoices,
        number,
      );
      await io.revealNumber(number);
      if (survivors.length === 0) {
        if (numberEliminated.length === 0) {
          // Nobody picked anything at all — the cog aborts the whole game.
          await io.nobodyAnswered();
          return { outcome: 'aborted', rounds: round };
        }
        // Everyone died at once WITH a pick — the round restarts, the number
        // stays enabled, the players stay (cog behavior).
        await io.roundRestart(number);
        round -= 1;
        continue;
      }
      disabled.push(number);
      await io.results(round, number, numberEliminated, timeoutEliminated, survivors);
      players = survivors;
    }
    const winnerId = players[0];
    const { prize, paid } = await awardPrize(game.guildId, winnerId);
    await io.winner(winnerId, prize, paid);
    return { outcome: 'winner', winnerId, rounds: round };
  } finally {
    endRolloutGame(game.channelId);
  }
}

/** Test seam: forget all live games. */
export function clearAllRolloutGames() {
  for (const channelId of [...games.keys()]) games.delete(channelId);
}
