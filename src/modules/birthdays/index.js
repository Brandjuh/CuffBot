import birthdaySet from './commands/birthday-set.js';
import birthdayRemove from './commands/birthday-remove.js';
import birthdays from './commands/birthdays.js';
import birthdayConfig from './commands/birthday-config.js';
import birthdaySweep from './events/birthday-sweep.js';

export default {
  name: 'birthdays',
  description:
    'Birthday watch: members register their birthday (own timezone supported) and the precinct celebrates them in the configured channel, once a year, on their own calendar day.',
  commands: [birthdaySet, birthdayRemove, birthdays, birthdayConfig],
  events: [birthdaySweep],
};
