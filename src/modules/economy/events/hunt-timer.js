// Timed random hunts (S56 owner request): crooks also appear in the owner's
// hunt channel on a random schedule, independent of chat activity. The gap is
// re-rolled after every tick (config read fresh each time), so spawn times
// never settle into a pattern and config changes apply without a restart.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { nextHuntTimerDelay } from '../lib/bank.js';
import { getEconomyConfig, runTimedHuntTick } from '../service.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    const guild = client.guilds.cache.get(client.config.homeGuildId);
    if (!guild) return;
    if (!client.messageContentAvailable) {
      // Without Message Content the shout is inaudible → every timed hunt
      // would be unwinnable. Disable outright and say why (S38 rule).
      logger.warn(
        'Economy: timed hunts stay OFF — Message Content intent unavailable, "STOP POLICE" would be inaudible.',
      );
      return;
    }
    const arm = () => {
      const delay = nextHuntTimerDelay(getEconomyConfig(guild.id));
      const timer = setTimeout(async () => {
        try {
          const result = await runTimedHuntTick(guild);
          if (result === 'no-channel') {
            logger.warn('Economy: timed hunt skipped — the configured hunt channel is not postable.');
          }
        } catch (error) {
          logger.warn('Economy: timed hunt tick failed:', error);
        }
        arm();
      }, delay);
      timer.unref?.();
    };
    arm();
  },
};
