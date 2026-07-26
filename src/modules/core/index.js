import radioCheck from './commands/radio-check.js';
import help from './commands/help.js';
import update from './commands/update.js';
import restart from './commands/restart.js';
import maintenance from './commands/maintenance.js';
import onDuty from './events/on-duty.js';
import guildLockdown from './events/guild-lockdown.js';
import updateReport from './events/update-report.js';
import updateAnnounce from './events/update-announce.js';
import autoUpdate from './events/auto-update.js';
import helpButtons from './events/help-buttons.js';

export default {
  name: 'core',
  description:
    'Core precinct utilities: the on-air check (!radiocheck), the button-driven command roster (!help), self-update the bot runs itself (`!update` installs, `!update status` reports, and an in-process 15-minute check installs anything green), config reload (!restart), an announcement in the update channel whenever the bot updates itself unattended, maintenance mode with a matching bot status, and single-guild jurisdiction enforcement.',
  commands: [radioCheck, help, update, restart, maintenance],
  events: [onDuty, guildLockdown, updateReport, updateAnnounce, autoUpdate, helpButtons],
};
