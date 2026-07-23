// CuffBot is a one-precinct bot: if it gets invited to any other guild while
// running, it leaves immediately. Keeps the bot's surface (and the owner's
// responsibility) limited to the server it was built for.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { isHomeGuild } from '../lib/precinct.js';

export default {
  name: Events.GuildCreate,
  async execute(guild) {
    const { homeGuildId } = guild.client.config;
    if (isHomeGuild(guild.id, homeGuildId)) return;
    logger.warn(`Out of jurisdiction: joined "${guild.name}" (${guild.id}) — leaving.`);
    await guild
      .leave()
      .catch((error) => logger.error(`Failed to leave guild ${guild.id}:`, error));
  },
};
