import radioCheck from './commands/radio-check.js';
import help from './commands/help.js';
import update from './commands/update.js';
import restart from './commands/restart.js';
import onDuty from './events/on-duty.js';
import guildLockdown from './events/guild-lockdown.js';
import updateReport from './events/update-report.js';

export default {
  name: 'core',
  description:
    'Core precinct utilities: presence (/radio-check), the command roster (/help), self-update (/update with in-Discord status), config reload (/restart), and single-guild jurisdiction enforcement.',
  commands: [radioCheck, help, update, restart],
  events: [onDuty, guildLockdown, updateReport],
};
