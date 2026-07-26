// Connect 4 service (S71 = M16.3): in-RAM games (one per channel — a restart
// forfeits the open game, like trivia rounds) + persistent guild stats. The
// cog's tie-stat bug is FIXED here: ties are recorded for the guild AND both
// players (upstream wrote them under a wrong key, so they never persisted).
import { getGuildData, updateGuildData } from '../../core/store.js';
import { COLS, createBoard, dropPiece, isFull, isWinningMove } from './lib/board.js';
import { chooseMove } from './lib/ai.js';

export const CONNECT4_STATS_KEY = 'connect4Stats';
export const CHALLENGE_TIMEOUT_MS = 60_000; // accept window (cog: 60 s)
export const MOVE_TIMEOUT_MS = 120_000; // inactivity forfeit (cog: 120 s)

const games = new Map(); // channelId → game

let seq = 0;

export function getGame(channelId) {
  return games.get(channelId) ?? null;
}

/**
 * Open a challenge. One game per channel (pending or playing).
 * @returns {{game}|{error:'busy'}}
 */
export function createChallenge(channelId, guildId, challengerId, opponentId, { botDepth = null } = {}) {
  if (games.has(channelId)) return { error: 'busy' };
  seq += 1;
  const game = {
    id: `${Date.now().toString(36)}-${seq}`,
    channelId,
    guildId,
    challengerId,
    opponentId,
    state: 'pending', // pending → playing
    board: createBoard(),
    turn: 1, // 1 = challenger 🔴, 2 = opponent 🔵
    message: null, // the challenge/board message, filled in by the command
    timer: null,
    // S100 (M23): a number here means player 2 is the BOT, searching this
    // deep. null is an ordinary duel between two members.
    botDepth,
  };
  games.set(channelId, game);
  return { game };
}

/** Is player 2 the bot? (S100) */
export const isSolo = (game) => typeof game?.botDepth === 'number';

export function startGame(game) {
  game.state = 'playing';
  return game;
}

export function endGame(channelId) {
  const game = games.get(channelId);
  if (game?.timer) clearTimeout(game.timer);
  games.delete(channelId);
  return game ?? null;
}

/** Re-arm the game's single timer (challenge expiry or move inactivity). */
export function armTimer(game, ms, callback) {
  if (game.timer) clearTimeout(game.timer);
  game.timer = setTimeout(callback, ms);
  game.timer.unref?.();
}

export function playerNumber(game, userId) {
  if (userId === game.challengerId) return 1;
  if (userId === game.opponentId) return 2;
  return 0;
}

/**
 * One move by userId into column col (0-based).
 * @returns {{code: 'not-player'|'not-your-turn'|'full-column'|'win'|'tie'|'next', row?: number}}
 */
export function dropMove(game, userId, col) {
  const player = playerNumber(game, userId);
  if (!player) return { code: 'not-player' };
  if (player !== game.turn) return { code: 'not-your-turn' };
  const row = dropPiece(game.board, col, player);
  if (row === -1) return { code: 'full-column' }; // the cog crashed here — we refuse politely
  if (isWinningMove(game.board, row, col)) return { code: 'win', row };
  if (isFull(game.board)) return { code: 'tie', row };
  game.turn = game.turn === 1 ? 2 : 1;
  return { code: 'next', row };
}

/**
 * The bot's reply in a solo game (S100). Returns the same shape as dropMove so
 * the button handler renders a bot move exactly like a human one.
 *
 * @returns {{ code:'win'|'tie'|'next'|'not-solo'|'not-your-turn'|'full-column', col?:number, row?:number }}
 */
export function playBotTurn(game, { chooser = chooseMove } = {}) {
  if (!isSolo(game)) return { code: 'not-solo' };
  if (game.turn !== 2) return { code: 'not-your-turn' };
  const col = chooser(game.board, 2, { depth: game.botDepth });
  if (col === -1) return { code: 'full-column' };
  const row = dropPiece(game.board, col, 2);
  if (row === -1) return { code: 'full-column' };
  if (isWinningMove(game.board, row, col)) return { code: 'win', col, row };
  if (isFull(game.board)) return { code: 'tie', col, row };
  game.turn = 1;
  return { code: 'next', col, row };
}

// ── stats (persistent) ───────────────────────────────────────────────────────

const emptyStats = () => ({ played: 0, ties: 0, players: {} });
const playerStats = (all, id) => all.players[id] ?? { wins: 0, losses: 0, ties: 0 };

/** Record a finished game: { winnerId, loserId } or { tie: [idA, idB] }. */
export function recordResult(guildId, result) {
  updateGuildData(
    guildId,
    CONNECT4_STATS_KEY,
    (raw) => {
      const all = { ...emptyStats(), ...raw, players: { ...(raw.players ?? {}) } };
      all.played += 1;
      if (result.tie) {
        all.ties += 1; // FIX: upstream never persisted ties (wrong key)
        for (const id of result.tie) {
          const p = playerStats(all, id);
          all.players[id] = { ...p, ties: p.ties + 1 };
        }
      } else {
        const winner = playerStats(all, result.winnerId);
        all.players[result.winnerId] = { ...winner, wins: winner.wins + 1 };
        const loser = playerStats(all, result.loserId);
        all.players[result.loserId] = { ...loser, losses: loser.losses + 1 };
      }
      return all;
    },
    emptyStats(),
  );
}

export function getStats(guildId) {
  const raw = getGuildData(guildId, CONNECT4_STATS_KEY, null);
  return { ...emptyStats(), ...(raw ?? {}), players: { ...(raw?.players ?? {}) } };
}

/** Top players by wins, for the 🥇🥈🥉 stats view. */
export function topPlayers(guildId, limit = 3) {
  return Object.entries(getStats(guildId).players)
    .map(([id, p]) => ({ id, ...p }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses)
    .slice(0, limit);
}

/** Test seam: forget all live games. */
export function clearAllGames() {
  for (const channelId of [...games.keys()]) endGame(channelId);
}
