// The hunting message watcher (S66): schedules spawns vrt-style and resolves
// STOP POLICE shouts / salutes in words mode. Never breaks message handling.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { isCatchPhrase } from '../../economy/lib/bank.js';
import { isSalute } from '../lib/hunt.js';
import { activeHunt, getHuntingConfig, noteMessage, resolveHunt } from '../service.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    try {
      const client = message.client;
      if (message.author?.bot || !message.guild || message.system) return;
      if (message.guild.id !== client.config.homeGuildId) return;

      // Words-mode shout at an open hunt first — a STOP POLICE must never
      // double as the activity that schedules the next crook.
      const hunt = activeHunt(message.channel.id);
      if (hunt && client.messageContentAvailable) {
        const config = getHuntingConfig(message.guild.id);
        if (config.mode === 'words') {
          if (isCatchPhrase(message.content)) {
            await resolveHunt(message.channel, message.member ?? message.author, 'catch');
            return;
          }
          if (hunt.crook.undercover && isSalute(message.content)) {
            await resolveHunt(message.channel, message.member ?? message.author, 'salute');
            return;
          }
        }
      }

      noteMessage(message);
    } catch (error) {
      logger.warn('Hunting: message handling failed:', error);
    }
  },
};
