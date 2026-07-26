import mafia from './commands/mafia.js';
import buttons from './events/buttons.js';

export default {
  name: 'mafia',
  description:
    'Classic mafia: one Boss, one medic, one detective, and a precinct that has to work out who is lying.',
  commands: [mafia],
  events: [buttons],
};
