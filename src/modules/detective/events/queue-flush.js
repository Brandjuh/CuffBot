// Drains the desk pile: every 10 seconds, if a parked question exists and the
// shared AI budget has a free slot, answer it in its original channel. The
// 10 s tick + one-answer-per-tick keeps the pace at the same cooldown members
// face directly.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { flushQueue } from '../service.js';

export const FLUSH_INTERVAL_MS = 10_000;

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    const tick = async () => {
      try {
        await flushQueue(client);
      } catch (error) {
        logger.warn('Detective: queue flush failed:', error);
      }
    };
    const timer = setInterval(tick, FLUSH_INTERVAL_MS);
    timer.unref?.();
  },
};
