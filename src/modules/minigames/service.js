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
export function createSession({
  channelId,
  guildId,
  players,
  againstBot,
  state,
  game = 'connect4',
  stake = null,
  now = Date.now(),
}) {
  return setGame(channelId, {
    id: randomUUID().slice(0, 8),
    channelId,
    guildId,
    game, // 'connect4' | 'tictactoe' — decides the renderer and the rules
    players, // [{ id, name, bot }]
    againstBot,
    accepted: againstBot, // no invitation to accept when the opponent is the bot
    state,
    // { amount, winAmount, taken } — `taken` flips when the money actually
    // leaves the players' wallets, which is what makes a refund decidable.
    stake: stake ?? { amount: 0, winAmount: 0, taken: false },
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
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { DEFAULT_STAKE_CONFIG, earningsDelta } from './lib/staking.js';

// ⚠️ **The storage key is deliberately the OLD one, and deliberately does not
// match the module name.** Every win, loss and tie recorded by the S71/S100
// `connect4` module carries straight over — replacing a module must not reset
// anybody's record. M26.2b adds Tic-Tac-Toe to the same counters (the cog
// pools both games into one set of stats too), which makes the name wronger
// still; renaming it would be cosmetic and would cost the precinct its
// history, so it stays. Read it as "the minigames stats", not as Connect 4's.
export const STATS_KEY = 'connect4Stats';
export const CONFIG_KEY = 'minigamesConfig';

const emptyStats = () => ({ played: 0, ties: 0, players: {} });
const emptyPlayer = () => ({ wins: 0, losses: 0, ties: 0, earnings: 0 });

export const getStats = (guildId) => {
  const raw = getGuildData(guildId, STATS_KEY, {}) ?? {};
  return { ...emptyStats(), ...raw, players: { ...(raw.players ?? {}) } };
};

export const playerStats = (all, id) => ({ ...emptyPlayer(), ...(all.players?.[id] ?? {}) });

/** Games played, derived rather than stored — one number that cannot drift. */
export const gamesOf = (p) => p.wins + p.losses + p.ties;
export const winRateOf = (p) => (gamesOf(p) === 0 ? 0 : (p.wins / gamesOf(p)) * 100);

/**
 * Record a finished game.
 *
 * @param {{tie?: string[], winnerId?: string, loserId?: string,
 *   stake?: {amount:number, winAmount:number}}} result
 *   A tie names both players; a decisive game names each side. `stake` moves
 *   each player's running earnings the way the cog does — the winner by
 *   `winAmount - bet`, the loser by `-bet`, a tie by nothing (correct only
 *   because a tie refunds both stakes).
 */
export function recordResult(guildId, result) {
  const stake = { amount: result.stake?.amount ?? 0, winAmount: result.stake?.winAmount ?? 0 };
  return updateGuildData(guildId, STATS_KEY, (raw) => {
    const all = { ...emptyStats(), ...raw, players: { ...(raw?.players ?? {}) } };
    all.played += 1;
    if (result.tie) {
      all.ties += 1;
      for (const id of result.tie) {
        const p = playerStats(all, id);
        all.players[id] = { ...p, ties: p.ties + 1, earnings: p.earnings + earningsDelta({ tied: true }, stake) };
      }
      return all;
    }
    const winner = playerStats(all, result.winnerId);
    all.players[result.winnerId] = {
      ...winner,
      wins: winner.wins + 1,
      earnings: winner.earnings + earningsDelta({ won: true }, stake),
    };
    const loser = playerStats(all, result.loserId);
    all.players[result.loserId] = {
      ...loser,
      losses: loser.losses + 1,
      earnings: loser.earnings + earningsDelta({ won: false }, stake),
    };
    return all;
  });
}

/** The cog's four sort keys. */
export const LEADERBOARD_SORTS = {
  wins: { label: 'Wins', value: (p) => p.wins, render: (p) => `${p.wins} win${p.wins === 1 ? '' : 's'}` },
  earnings: {
    label: 'Earnings',
    value: (p) => p.earnings,
    render: (p) => `${p.earnings >= 0 ? '+' : '−'}${Math.abs(p.earnings).toLocaleString('en-US')} 🍩`,
  },
  games: { label: 'Games', value: gamesOf, render: (p) => `${gamesOf(p)} game${gamesOf(p) === 1 ? '' : 's'}` },
  winrate: { label: 'Win rate', value: winRateOf, render: (p) => `${winRateOf(p).toFixed(1)}%` },
};

/**
 * Players ordered by one of the four keys.
 *
 * Members with no games are dropped (the cog does the same) — a 0% win rate
 * from never having played would otherwise sit above everyone on an ascending
 * read and below everyone on a descending one, meaning nothing either way. The
 * tie-break chain is total, so the order is stable across calls.
 */
export function leaderboard(guildId, sort = 'wins', limit = 10) {
  const spec = LEADERBOARD_SORTS[sort] ?? LEADERBOARD_SORTS.wins;
  const all = getStats(guildId);
  return Object.entries(all.players)
    .map(([id, p]) => ({ id, ...emptyPlayer(), ...p }))
    .filter((p) => gamesOf(p) > 0)
    .sort((a, b) => spec.value(b) - spec.value(a) || b.wins - a.wins || a.losses - b.losses || a.id.localeCompare(b.id))
    .slice(0, limit);
}

// ── configuration ────────────────────────────────────────────────────────────

/** Sparse overrides on top of the cog's defaults (the S35 pattern). */
export const getMinigamesConfig = (guildId) => ({
  ...DEFAULT_STAKE_CONFIG,
  ...getGuildData(guildId, CONFIG_KEY, {}),
});

export function setMinigamesConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, CONFIG_KEY, stored);
  return { ...DEFAULT_STAKE_CONFIG, ...stored };
}
