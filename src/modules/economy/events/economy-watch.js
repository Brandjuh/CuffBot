// One MessageCreate handler drives economy activity pay (event-only — works
// without the Message Content intent, like message XP). The crook hunt moved
// to its own module in S66 (M16.1). Economy must never break message handling.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { awardActivity, getEconomyConfig } from '../service.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      const client = message.client;
      if (message.author?.bot || !message.guild || message.system) return;
      if (message.guild.id !== client.config.homeGuildId) return;
      const config = getEconomyConfig(message.guild.id);
      if (!config.enabled) return;
      awardActivity(message.guild.id, message.author.id, Date.now());
    } catch (error) {
      logger.warn('Economy: message handling failed:', error);
    }
  },
};
