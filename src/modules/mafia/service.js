// Mafia game storage and the per-channel table (S105 = M24.1). Every rule
// lives in lib/game.js; this file holds the RAM-only game registry, the
// persisted stats, and the phase timers.
//
// Games are RAM-only on purpose. A mafia game is a live, hour-long
// conversation: a restart mid-game leaves the room, not a half-state to
// resume, and the S71 connect4 precedent is the same call for the same reason.
// Stats persist.
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { DEFAULT_MAFIA_CONFIG } from './lib/config.js';
import { isMafia } from './lib/roles.js';

export const MAFIA_CONFIG_KEY = 'mafiaConfig';
export const MAFIA_STATS_KEY = 'mafiaStats';

export function getMafiaConfig(guildId) {
  return { ...DEFAULT_MAFIA_CONFIG, ...getGuildData(guildId, MAFIA_CONFIG_KEY, {}) };
}

export function setMafiaConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, MAFIA_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, MAFIA_CONFIG_KEY, stored);
  return { ...DEFAULT_MAFIA_CONFIG, ...stored };
}

export const getStats = (guildId) => getGuildData(guildId, MAFIA_STATS_KEY, {});
export const resetStats = (guildId) => setGuildData(guildId, MAFIA_STATS_KEY, {});

/**
 * Credit a finished game. One row per member: games, wins, and a per-role
 * breakdown so `!mafia stats` can say "3 wins as the Boss" rather than a bare
 * number.
 */
export function recordResult(guildId, game) {
  updateGuildData(
    guildId,
    MAFIA_STATS_KEY,
    (stats = {}) => {
      const next = { ...stats };
      for (const player of game.players) {
        const side = isMafia(player.roleId) ? 'mafia' : 'villagers';
        const row = next[player.id] ?? { games: 0, wins: 0, roles: {} };
        const roleRow = row.roles[player.roleId] ?? { games: 0, wins: 0 };
        const won = side === game.winner;
        next[player.id] = {
          games: row.games + 1,
          wins: row.wins + (won ? 1 : 0),
          roles: {
            ...row.roles,
            [player.roleId]: { games: roleRow.games + 1, wins: roleRow.wins + (won ? 1 : 0) },
          },
        };
      }
      return next;
    },
    {},
  );
}

/** channelId → { game, timer, messageId }. RAM only, by design (see the header). */
const tables = new Map();

export const tableIn = (channelId) => tables.get(channelId) ?? null;
export const gameIn = (channelId) => tables.get(channelId)?.game ?? null;

export function setTable(channelId, patch) {
  const existing = tables.get(channelId) ?? {};
  const next = { ...existing, ...patch };
  tables.set(channelId, next);
  return next;
}

export function clearTable(channelId) {
  const table = tables.get(channelId);
  if (table?.timer) clearTimeout(table.timer);
  tables.delete(channelId);
}

/** Tests and a clean shutdown: drop every table without touching Discord. */
export function resetMafiaTables() {
  for (const channelId of [...tables.keys()]) clearTable(channelId);
}

/**
 * Arm the phase deadline. Injectable, so the whole suite runs instantly — a
 * game whose phases are minutes long is untestable with real timers (S99).
 */
export function armPhaseTimer(channelId, ms, onFire, { setTimer, clearTimer } = {}) {
  const table = tables.get(channelId);
  if (!table) return null;
  if (table.timer) (clearTimer ?? ((t) => clearTimeout(t)))(table.timer);
  const timer = (setTimer ?? ((fn, delay) => setTimeout(fn, delay)))(() => {
    onFire().catch(() => {});
  }, ms);
  timer?.unref?.();
  tables.set(channelId, { ...table, timer });
  return timer;
}

export function disarmPhaseTimer(channelId, { clearTimer } = {}) {
  const table = tables.get(channelId);
  if (!table?.timer) return;
  (clearTimer ?? ((t) => clearTimeout(t)))(table.timer);
  tables.set(channelId, { ...table, timer: null });
}
