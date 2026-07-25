// Watches every message for the kill counter (S99 = M20). Deliberately does
// nothing but hand the message to the service — the eligibility rules and the
// timing both live where they can be tested.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { noteMessage } from '../service.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild) return;
    try {
      noteMessage(message.guild.id, message);
    } catch (error) {
      logger.warn('Kill counter: could not note a message:', error);
    }
  },
};
