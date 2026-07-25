// The thin wrapper that actually sets the presence (S98 = M22). Everything
// decidable is in lib/presence.js; this file only reads the stored state and
// hands the payload to Discord.
import { getMaintenance } from '../../core/maintenance.js';
import { logger } from '../../core/logger.js';
import { presenceFor } from './lib/presence.js';

/**
 * Push the presence that matches the CURRENT stored maintenance state.
 *
 * Reading from the store rather than from a variable is what makes this
 * survive a restart: the boot path calls it with nothing else to go on, and a
 * bot that came back up still in maintenance must still LOOK like it.
 *
 * Never throws — a presence is cosmetic and must not take down a boot or a
 * maintenance toggle.
 *
 * @returns {boolean} the maintenance state that was applied
 */
export function syncPresence(client) {
  const maintenance = Boolean(getMaintenance(client.config?.homeGuildId).enabled);
  try {
    client.user?.setPresence?.(presenceFor(maintenance));
  } catch (error) {
    logger.warn('Presence: could not update the bot status:', error);
  }
  return maintenance;
}
