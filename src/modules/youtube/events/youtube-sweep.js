// Polls the creators' feeds every 10 minutes (plus once shortly after boot).
// The interval is unref'ed so it never keeps the process alive; a sweep can
// never break anything else (guarded, and sweepYouTube itself never throws
// past its own logging).
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { sweepYouTube } from '../service.js';

export const SWEEP_INTERVAL_MS = 10 * 60_000;

export default {
  name: Events.ClientReady,
  async execute(client) {
    const tick = async () => {
      try {
        const guild = client.guilds.cache.get(client.config.homeGuildId);
        if (guild) await sweepYouTube(guild);
      } catch (error) {
        logger.warn('YouTube: sweep tick failed:', error);
      }
    };
    const interval = setInterval(tick, SWEEP_INTERVAL_MS);
    interval.unref?.();
    // First tick soon after boot so a restart never delays announcements long.
    setTimeout(tick, 15_000).unref?.();
  },
};
