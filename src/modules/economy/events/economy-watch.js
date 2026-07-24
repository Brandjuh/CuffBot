// One MessageCreate handler drives the whole economy: activity earnings
// (event-only — works without the Message Content intent, like message XP),
// catching an open hunt ("STOP POLICE" — needs Message Content), and the
// spawn roll for new hunts. Economy must never break message handling.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { isCatchPhrase } from '../lib/bank.js';
import {
  activeHunt,
  awardActivity,
  getEconomyConfig,
  noteActivityAndMaybeSpawn,
  resolveCatch,
} from '../service.js';

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

      // Catch first: a "STOP POLICE" during an open hunt must never double as
      // the activity that spawns the next crook.
      if (
        activeHunt(message.channel.id) &&
        client.messageContentAvailable &&
        isCatchPhrase(message.content)
      ) {
        await resolveCatch(message);
        return;
      }

      await noteActivityAndMaybeSpawn(message);
    } catch (error) {
      logger.warn('Economy: message handling failed:', error);
    }
  },
};
