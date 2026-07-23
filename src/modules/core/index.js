import radioCheck from './commands/radio-check.js';
import help from './commands/help.js';
import update from './commands/update.js';
import onDuty from './events/on-duty.js';
import guildLockdown from './events/guild-lockdown.js';

export default {
  name: 'core',
  description:
    'Core precinct utilities: presence (/radio-check), the command roster (/help), self-update (/update), and single-guild jurisdiction enforcement.',
  commands: [radioCheck, help, update],
  events: [onDuty, guildLockdown],
};
