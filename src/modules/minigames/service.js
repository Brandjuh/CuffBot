// Minigames session registry (M26.2a). Ported from the `minigames` cog the
// owner pointed at, whose rules differ from the S71 connect4 module this
// replaces:
//
//   * **One game per CHANNEL**, not per pair of players (the cog keys its
//     `self.games` dict by channel id).
//   * A game idle past `TIME_LIMIT` may be **replaced by anyone**, rather than
//     forfeited on a timer. That is the cog's answer to abandoned games and it
//     needs no scheduled work at all — the staleness is only ever evaluated
//     when somebody actually wants the channel.
//
// Games are RAM-only, the same call S71 made for connect4 and S105 for mafia:
// a duel that survives a restart would resume with a board nobody is still
// looking at. Stats persist (26.2b).
import { randomUUID } from 'node:crypto';

/** The cog's TIME_LIMIT: minutes of inactivity after which anyone may replace. */
export const STALE_MINUTES = 5;

/** channelId → session */
const games = new Map();

export const getGame = (channelId) => games.get(channelId) ?? null;

export function setGame(channelId, game) {
  games.set(channelId, game);
  return game;
}

export function endGame(channelId) {
  const game = games.get(channelId);
  games.delete(channelId);
  return game ?? null;
}

/** Test seam — the registry is process-wide, so suites must be able to reset. */
export const clearGames = () => games.clear();

/**
 * May a new game take this channel?
 *
 * Returns a *reason*, not a boolean, because the caller has to explain the
 * refusal — "someone is already playing" and "that game went stale, replacing
 * it" are different messages and only one of them is a no.
 */
export function channelAvailability(channelId, now = Date.now()) {
  const game = games.get(channelId);
  if (!game) return { ok: true, reason: 'free' };
  if (game.finished) return { ok: true, reason: 'finished' };
  const idleMs = now - game.lastInteracted;
  if (idleMs >= STALE_MINUTES * 60_000) return { ok: true, reason: 'stale' };
  return { ok: false, reason: 'busy', minutesLeft: Math.max(1, Math.ceil((STALE_MINUTES * 60_000 - idleMs) / 60_000)) };
}

/**
 * A fresh session. `players[0]` is RED and moves are indexed against that, so
 * the order here IS the colour assignment — the cog puts the human first when
 * playing the bot, which is why `!c4` alone always makes you red.
 */
export function createSession({ channelId, guildId, players, againstBot, state, now = Date.now() }) {
  return setGame(channelId, {
    id: randomUUID().slice(0, 8),
    channelId,
    guildId,
    players, // [{ id, name, bot }]
    againstBot,
    accepted: againstBot, // no invitation to accept when the opponent is the bot
    state,
    finished: false,
    cancelled: false,
    messageId: null,
    lastInteracted: now,
  });
}

export function touch(game, now = Date.now()) {
  game.lastInteracted = now;
  return game;
}

/** Which seat this user holds (0 = RED, 1 = BLUE), or -1 for a spectator. */
export const seatOf = (game, userId) => game?.players?.findIndex((p) => p.id === userId) ?? -1;

// ── stats ────────────────────────────────────────────────────────────────────
//
// Pulled forward from the planned 26.2b slice. The plan said the old connect4
// module would stay until then so nothing regressed mid-way — but the loader
// rejects two commands with the same name, so keeping both was never actually
// available (the same class of constraint S105 hit with `index.js`). Deleting
// the old module therefore had to happen NOW, and deleting it without stats
// would have taken the precinct's scoreboard away for a session.
//
// **The storage key is deliberately the old one.** Every existing win, loss
// and tie carries straight over; replacing the module must not reset anybody's
// record.
import { getGuildData, updateGuildData } from '../../core/store.js';

export const STATS_KEY = 'connect4Stats';

const emptyStats = () => ({ played: 0, ties: 0, players: {} });
const emptyPlayer = () => ({ wins: 0, losses: 0, ties: 0 });

export const getStats = (guildId) => {
  const raw = getGuildData(guildId, STATS_KEY, {}) ?? {};
  return { ...emptyStats(), ...raw, players: { ...(raw.players ?? {}) } };
};

export const playerStats = (all, id) => ({ ...emptyPlayer(), ...(all.players?.[id] ?? {}) });

/**
 * Record a finished game.
 *
 * @param {{tie?: string[], winnerId?: string, loserId?: string}} result
 *   A tie names both players; a decisive game names each side.
 */
export function recordResult(guildId, result) {
  return updateGuildData(guildId, STATS_KEY, (raw) => {
    const all = { ...emptyStats(), ...raw, players: { ...(raw?.players ?? {}) } };
    all.played += 1;
    if (result.tie) {
      all.ties += 1;
      for (const id of result.tie) {
        const p = playerStats(all, id);
        all.players[id] = { ...p, ties: p.ties + 1 };
      }
      return all;
    }
    const winner = playerStats(all, result.winnerId);
    all.players[result.winnerId] = { ...winner, wins: winner.wins + 1 };
    const loser = playerStats(all, result.loserId);
    all.players[result.loserId] = { ...loser, losses: loser.losses + 1 };
    return all;
  });
}

/** Players ordered by wins, then fewest losses — ties broken deterministically. */
export function leaderboard(guildId, limit = 10) {
  const all = getStats(guildId);
  return Object.entries(all.players)
    .map(([id, p]) => ({ id, ...emptyPlayer(), ...p }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || a.id.localeCompare(b.id))
    .slice(0, limit);
}
