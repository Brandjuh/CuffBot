// Greets every new member. GuildMemberAdd only fires when the privileged
// Server Members Intent is enabled in the Developer Portal — without it this
// handler simply never runs (the /welcome-config status warns about that).
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { postWelcome } from '../service.js';

export default {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      if (member.guild?.id !== member.client.config.homeGuildId) return;
      if (member.user?.bot) return; // bots get cuffs, not coffee
      await postWelcome(member.guild, member.id, { displayName: member.displayName });
    } catch (error) {
      logger.warn('Welcome: join handling failed:', error);
    }
  },
};
