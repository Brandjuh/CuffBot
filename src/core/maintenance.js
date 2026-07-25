// Maintenance mode (S74; S75 owner correction): one switch that closes the
// command desk for everyone EXCEPT the **bot owner** — the owner of the
// Discord APPLICATION (client.application.owner), not the guild owner. The
// owner resolves structurally (never a raw id); for a team-owned application
// every team member counts. The router consults this before dispatching ANY
// command (group or legacy); events, sweeps, and component pumps keep running
// — only commands are gated.
import { getGuildData, setGuildData } from './store.js';

export const MAINTENANCE_KEY = 'maintenanceConfig';

export const DEFAULT_MAINTENANCE_MESSAGE =
  '🚧 CuffBot is under maintenance. Only the bot owner can use commands right now — back on duty soon.';

export const DEFAULT_MAINTENANCE_CONFIG = { enabled: false, message: null };

export function getMaintenance(guildId) {
  return { ...DEFAULT_MAINTENANCE_CONFIG, ...getGuildData(guildId, MAINTENANCE_KEY, {}) };
}

export function setMaintenance(guildId, patch) {
  const stored = { ...getGuildData(guildId, MAINTENANCE_KEY, {}), ...patch };
  setGuildData(guildId, MAINTENANCE_KEY, stored);
  return { ...DEFAULT_MAINTENANCE_CONFIG, ...stored };
}

/**
 * The bot-owner id set, resolved from the application once and cached on the
 * client. A failed fetch is NOT cached — the next check retries, so a
 * transient API hiccup can never permanently lock the owner out.
 */
export async function getBotOwnerIds(client) {
  if (client.botOwnerIds instanceof Set) return client.botOwnerIds;
  try {
    let app = client.application;
    if (app && !app.owner && typeof app.fetch === 'function') app = await app.fetch();
    const owner = app?.owner;
    const ids = new Set();
    if (owner?.members) for (const id of owner.members.keys()) ids.add(id); // team-owned app
    else if (owner?.id) ids.add(owner.id);
    if (ids.size > 0) client.botOwnerIds = ids; // cache only a real answer
    return ids;
  } catch {
    return new Set();
  }
}

export async function isBotOwner(client, userId) {
  return (await getBotOwnerIds(client)).has(userId);
}

/**
 * The router's gate: the notice to reply with, or null when the command may
 * run (maintenance off, or the invoker owns the bot). The owner lookup only
 * runs while maintenance is ON — the everyday path costs nothing.
 */
export async function maintenanceNotice(client, guildId, userId) {
  const config = getMaintenance(guildId);
  if (!config.enabled) return null;
  if (await isBotOwner(client, userId)) return null;
  return config.message ?? DEFAULT_MAINTENANCE_MESSAGE;
}
