// Polling scheduler: honor new entries every 30 minutes (memorial feeds
// update rarely; polite polling is part of being a good citizen toward these
// organizations). A tick at boot covers anything missed while offline.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { sweepMemorial } from '../service.js';

export const SWEEP_INTERVAL_MS = 30 * 60_000;

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    const tick = async () => {
      try {
        const guild = client.guilds.cache.get(client.config.homeGuildId);
        if (guild) await sweepMemorial(guild);
      } catch (error) {
        logger.warn('Memorial: sweep failed:', error);
      }
    };
    await tick();
    const timer = setInterval(tick, SWEEP_INTERVAL_MS);
    timer.unref?.();
  },
};
