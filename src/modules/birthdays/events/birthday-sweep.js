// Announcement scheduler: every 10 minutes, check whether anyone's birthday
// has started in THEIR timezone (no midnight job to miss — a Pi that reboots
// at 00:05 still announces at 00:10+). The sweep is idempotent per local year,
// so the interval can fire as often as it likes.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { sweepBirthdays, syncBirthdayRole } from '../service.js';

export const SWEEP_INTERVAL_MS = 10 * 60_000;

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    const tick = async () => {
      try {
        const guild = client.guilds.cache.get(client.config.homeGuildId);
        if (!guild) return;
        // Role first (S58): the celebrant already wears the role when the
        // announcement lands. Each step has its own catch — a role failure
        // must never silence the announcement, or vice versa.
        await syncBirthdayRole(guild).catch((error) =>
          logger.warn('Birthdays: role sync failed:', error),
        );
        await sweepBirthdays(guild);
      } catch (error) {
        logger.warn('Birthdays: sweep failed:', error);
      }
    };
    await tick(); // catch anything already due at boot
    const timer = setInterval(tick, SWEEP_INTERVAL_MS);
    timer.unref?.(); // never keep the process alive on its own
  },
};
