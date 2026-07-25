// Maintenance mode (S74, owner request): one switch that closes the command
// desk for everyone EXCEPT the precinct owner, who keeps full access. The
// owner resolves structurally via guild.ownerId (S40 rule — never a raw id).
// The router consults this before dispatching ANY command (group or legacy);
// events, sweeps, and component pumps keep running — only commands are gated.
import { getGuildData, setGuildData } from './store.js';

export const MAINTENANCE_KEY = 'maintenanceConfig';

export const DEFAULT_MAINTENANCE_MESSAGE =
  '🚧 CuffBot is under maintenance. Only the precinct owner can use commands right now — back on duty soon.';

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
 * The router's gate: the notice to reply with, or null when the command may
 * run (maintenance off, or the invoker owns the precinct).
 */
export function maintenanceNotice(guild, userId) {
  const config = getMaintenance(guild.id);
  if (!config.enabled) return null;
  if (userId === guild.ownerId) return null;
  return config.message ?? DEFAULT_MAINTENANCE_MESSAGE;
}
