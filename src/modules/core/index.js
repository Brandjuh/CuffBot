import radioCheck from './commands/radio-check.js';
import onDuty from './events/on-duty.js';
import guildLockdown from './events/guild-lockdown.js';

export default {
  name: 'core',
  description:
    'Core precinct utilities: presence (/radio-check) and single-guild jurisdiction enforcement.',
  commands: [radioCheck],
  events: [onDuty, guildLockdown],
};
