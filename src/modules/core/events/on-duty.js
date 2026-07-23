// Fires once when the gateway connection is up: announce, then sweep out any
// guild the bot is in that is not the home precinct (it may have been invited
// elsewhere while offline — the lockdown event below only covers live joins).
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { isHomeGuild } from '../lib/precinct.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    logger.info(`🚔 CuffBot on duty as ${client.user.tag}.`);
    const { homeGuildId } = client.config;
    for (const guild of client.guilds.cache.values()) {
      if (isHomeGuild(guild.id, homeGuildId)) continue;
      logger.warn(`Out of jurisdiction: "${guild.name}" (${guild.id}) — leaving.`);
      await guild
        .leave()
        .catch((error) => logger.error(`Failed to leave guild ${guild.id}:`, error));
    }
    if (!client.guilds.cache.has(homeGuildId)) {
      logger.warn(
        `Not in the home precinct (${homeGuildId}) yet — invite the bot there (README → Quickstart).`,
      );
    }
  },
};
