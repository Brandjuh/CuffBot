import radioCheck from './commands/radio-check.js';
import help from './commands/help.js';
import update from './commands/update.js';
import restart from './commands/restart.js';
import maintenance from './commands/maintenance.js';
import onDuty from './events/on-duty.js';
import guildLockdown from './events/guild-lockdown.js';
import updateReport from './events/update-report.js';
import helpButtons from './events/help-buttons.js';

export default {
  name: 'core',
  description:
    'Core precinct utilities: the on-air check (!radiocheck), the button-driven command roster (!help), self-update (!update with in-Discord status), config reload (!restart), maintenance mode with a matching bot status, and single-guild jurisdiction enforcement.',
  commands: [radioCheck, help, update, restart, maintenance],
  events: [onDuty, guildLockdown, updateReport, helpButtons],
};
