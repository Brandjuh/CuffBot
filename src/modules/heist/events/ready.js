// Heist boot catch-up (S87): re-arm every job that was running when the bot
// stopped. Jobs whose clock ran out while we were down settle immediately —
// the same thing the cog does on load — so a restart mid-heist costs nothing.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { rearmAllHeists } from '../scheduler.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      await rearmAllHeists(client);
    } catch (error) {
      logger.error('Heist: boot re-arm failed:', error);
    }
  },
};
