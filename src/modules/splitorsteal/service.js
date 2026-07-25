// Split-or-steal service (S79 = M16.6): one RAM game per channel, the choice
// bridge between the button pump and the runner, and the io-driven runner
// itself (the russian-roulette engine pattern). Cog-faithful flow: a FIXED
// 60 s join window (never ends early), two random contestants, a 60 s secret
// choice, the classic matrix. No prize, no persistence, no config.
import { CHOOSE_WINDOW_MS, JOIN_WINDOW_MS, pickTwoPlayers, resolveSos } from './lib/game.js';

const games = new Map(); // channelId → game

let seq = 0;

export function getSosGame(channelId) {
  return games.get(channelId) ?? null;
}

export function createSosGame(channelId, guildId) {
  if (games.has(channelId)) return { error: 'busy' };
  seq += 1;
  const game = {
    id: `${Date.now().toString(36)}-${seq}`,
    channelId,
    guildId,
    state: 'join', // join → choose → done
    joiners: [],
    players: null, // [idA, idB] once drawn
    choices: {}, // id → 'split' | 'steal'
    message: null,
    onBothChosen: null, // the runner's resolver while waiting
  };
  games.set(channelId, game);
  return { game };
}

export function endSosGame(channelId) {
  games.delete(channelId);
}

/** Join during the join phase. @returns {'joined'|'already'|'closed'} */
export function joinSos(game, userId) {
  if (game.state !== 'join') return 'closed';
  if (game.joiners.includes(userId)) return 'already';
  game.joiners.push(userId);
  return 'joined';
}

/**
 * A Split/Steal press. @returns {'recorded'|'not-player'|'already'|'closed'}
 * `already` carries the original choice (the cog echoes it back).
 */
export function chooseSos(game, userId, choice) {
  if (game.state !== 'choose') return { code: 'closed' };
  if (!game.players?.includes(userId)) return { code: 'not-player' };
  if (game.choices[userId]) return { code: 'already', original: game.choices[userId] };
  game.choices[userId] = choice;
  if (game.players.every((id) => game.choices[id]) && game.onBothChosen) game.onBothChosen();
  return { code: 'recorded' };
}

/** Resolves 'chosen' when both contestants picked, 'timeout' otherwise. */
function awaitChoices(game, timeoutMs) {
  return new Promise((resolve) => {
    if (game.players.every((id) => game.choices[id])) {
      resolve('chosen');
      return;
    }
    const timer = setTimeout(() => {
      game.onBothChosen = null;
      resolve('timeout');
    }, timeoutMs);
    timer.unref?.();
    game.onBothChosen = () => {
      clearTimeout(timer);
      game.onBothChosen = null;
      resolve('chosen');
    };
  });
}

/**
 * The whole match (the cog's view.start flow, event-driven). `io` is the
 * Discord surface: { openLobby(endsAtMs), sleep(ms), notEnough(),
 * showChoices(a, b, endsAtMs), timedOut(), result(kind, a, b) } — production
 * wires the embeds/buttons; tests script it.
 * @returns {Promise<{outcome: string, players?: string[]}>}
 */
export async function runSosGame(
  game,
  io,
  { random = Math.random, joinMs = JOIN_WINDOW_MS, chooseMs = CHOOSE_WINDOW_MS, now = () => Date.now() } = {},
) {
  try {
    await io.openLobby(now() + joinMs);
    await io.sleep(joinMs); // fixed window — the cog never ends it early
    if (game.joiners.length < 2) {
      game.state = 'done';
      await io.notEnough();
      return { outcome: 'not-enough-players' };
    }
    const [a, b] = pickTwoPlayers(random, game.joiners);
    game.players = [a, b];
    game.state = 'choose';
    await io.showChoices(a, b, now() + chooseMs);
    const waited = await awaitChoices(game, chooseMs);
    game.state = 'done';
    if (waited === 'timeout') {
      await io.timedOut();
      return { outcome: 'timeout', players: [a, b] };
    }
    const kind = resolveSos(game.choices[a], game.choices[b]);
    await io.result(kind, a, b);
    return { outcome: kind, players: [a, b] };
  } finally {
    endSosGame(game.channelId);
  }
}

/** Test seam: forget all live games. */
export function clearAllSosGames() {
  for (const channelId of [...games.keys()]) games.delete(channelId);
}
