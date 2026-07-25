// Russian-roulette service (S73 = M16.5): the lobby, the shot-waiting bridge
// between the button pump and the round runner, and the engine itself. The
// engine talks to Discord ONLY through an injected io — tests script it.
//
// Two upstream bugs are FIXED here (recorded deviations):
// 1. The cog mutates the player list while iterating it, silently SKIPPING
//    the player after every AFK death — we iterate a snapshot of the round
//    order instead.
// 2. When every remaining player dies AFK in one round the cog crashes on
//    `players[0]` — we end the game with a "nobody survived" message.
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  pickMisfireVictim,
  rollBullet,
  rollSelfDeath,
  shufflePlayers,
} from './lib/game.js';

export const SHOT_TIMEOUT_MS = 5_000; // per turn (cog: 5 s)
export const DRAMA_MS = 2_000; // the pause after "pulled the trigger…" (cog: 2 s)

const games = new Map(); // channelId → game

let seq = 0;

export function getRouletteGame(channelId) {
  return games.get(channelId) ?? null;
}

/** Open a lobby; the host auto-joins (cog behavior). One game per channel. */
export function createLobby(channelId, guildId, hostId) {
  if (games.has(channelId)) return { error: 'busy' };
  seq += 1;
  const game = {
    id: `${Date.now().toString(36)}-${seq}`,
    channelId,
    guildId,
    hostId,
    players: [hostId],
    state: 'lobby', // lobby → running
    lobbyMessage: null,
    pendingShot: null, // { playerId, resolve, timer } while a turn is open
  };
  games.set(channelId, game);
  return { game };
}

export function joinLobby(game, userId) {
  if (game.players.includes(userId)) return 'already';
  if (game.players.length >= MAX_PLAYERS) return 'full';
  game.players.push(userId);
  return 'joined';
}

export function leaveLobby(game, userId) {
  const index = game.players.indexOf(userId);
  if (index === -1) return 'not-joined';
  game.players.splice(index, 1);
  return 'left';
}

export function endRouletteGame(channelId) {
  const game = games.get(channelId);
  if (game?.pendingShot?.timer) clearTimeout(game.pendingShot.timer);
  games.delete(channelId);
  return game ?? null;
}

/**
 * Wait for one player's Shoot press (the pump resolves it) or the timeout.
 * @returns {Promise<'shot'|'timeout'>}
 */
export function awaitShot(game, playerId, timeoutMs = SHOT_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      game.pendingShot = null;
      resolve('timeout');
    }, timeoutMs);
    timer.unref?.();
    game.pendingShot = {
      playerId,
      resolve: () => {
        clearTimeout(timer);
        game.pendingShot = null;
        resolve('shot');
      },
      timer,
    };
  });
}

/** Called by the button pump; true when the press was the awaited player's. */
export function resolveShot(game, userId) {
  if (!game.pendingShot || game.pendingShot.playerId !== userId) return false;
  game.pendingShot.resolve();
  return true;
}

/**
 * The round runner (the cog's command body, texts verbatim). `io` is the
 * whole Discord surface: { say(payload), askShot(playerId) → 'shot'|'timeout',
 * sleep(ms) } — production wires channel.send + awaitShot; tests script it.
 * @returns {Promise<{winnerId: string|null, rounds: number}>}
 */
export async function runGame(game, io, { random = Math.random, dramaMs = DRAMA_MS } = {}) {
  game.state = 'running';
  const alive = [...game.players];
  let round = 0;
  try {
    while (alive.length > 1) {
      round += 1;
      await io.say({ round, playersLeft: alive.length, kind: 'round' });
      const bullet = rollBullet(random, alive.length);
      const order = shufflePlayers(random, alive); // snapshot — fixes the cog's skip bug
      for (let i = 0; i < order.length; i += 1) {
        if (alive.length <= 1) break; // fixes the cog's everyone-AFK crash
        const playerId = order[i];
        if (!alive.includes(playerId)) continue;
        const outcome = await io.askShot(playerId);
        if (outcome === 'timeout') {
          alive.splice(alive.indexOf(playerId), 1);
          await io.say({ kind: 'afk', playerId });
          continue;
        }
        await io.say({ kind: 'trigger', playerId });
        await io.sleep(dramaMs);
        if (i === bullet) {
          if (rollSelfDeath(random)) {
            alive.splice(alive.indexOf(playerId), 1);
            await io.say({ kind: 'dead', playerId });
          } else {
            const victimId = pickMisfireVictim(random, alive, playerId);
            alive.splice(alive.indexOf(victimId), 1);
            await io.say({ kind: 'misfire', playerId, victimId });
          }
          break; // one chambered round per round — the round is over
        }
        await io.say({ kind: 'click' });
      }
    }
    const winnerId = alive[0] ?? null;
    await io.say(winnerId ? { kind: 'winner', playerId: winnerId } : { kind: 'nobody' });
    return { winnerId, rounds: round };
  } finally {
    endRouletteGame(game.channelId);
  }
}

/** Test seam: forget all live games. */
export function clearAllRouletteGames() {
  for (const channelId of [...games.keys()]) endRouletteGame(channelId);
}

export { MAX_PLAYERS, MIN_PLAYERS };
