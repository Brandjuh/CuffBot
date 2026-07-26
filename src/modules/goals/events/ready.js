// Arms the auto-tracked goal sweep at boot (S103 = M14). The sweep exists only
// for goals whose number lives on the guild (members, boosts): nobody runs a
// command when the 1000th member joins, so something has to look.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { startGoalSweep, sweepAll } from '../service.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      await sweepAll(client); // catch up on anything that changed while offline
      startGoalSweep(client);
    } catch (error) {
      logger.warn('Goals: could not start the sweep:', error);
    }
  },
};
