// The bot's presence (S98 = M22, owner request: "geef via een botstatus aan of
// de bot in maintance mode is of normale operatie").
//
// Pure: `presenceFor` is a plain state → payload map so the two statuses are
// testable without a gateway. The one thin wrapper that actually calls Discord
// lives in ../service-presence.js.
//
// Note on scope: maintenance is stored PER GUILD but a presence is per BOT and
// global. CuffBot serves exactly one precinct by design (S1), so the home
// guild's maintenance state is the whole truth — which is why the caller reads
// it for `config.homeGuildId` rather than trying to merge guilds.
import { ActivityType, PresenceUpdateStatus } from 'discord.js';

/**
 * @param {boolean} maintenance
 * @returns {{ status: string, activities: Array<{ name: string, type: number }> }}
 */
export function presenceFor(maintenance) {
  return maintenance
    ? {
        status: PresenceUpdateStatus.DoNotDisturb,
        activities: [{ name: '🔧 Maintenance — bot owner only', type: ActivityType.Custom }],
      }
    : {
        status: PresenceUpdateStatus.Online,
        activities: [{ name: 'the precinct 🚔', type: ActivityType.Watching }],
      };
}

/** A one-line human description, for `!maintenance` replies and the manual. */
export const presenceLabel = (maintenance) =>
  maintenance ? 'Do Not Disturb · 🔧 Maintenance — bot owner only' : 'Online · Watching the precinct 🚔';
