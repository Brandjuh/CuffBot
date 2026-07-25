import russianroulette from './commands/russianroulette.js';
import buttons from './events/buttons.js';

export default {
  name: 'russianroulette',
  description:
    'Russian roulette (ported from AAA3A-cogs): a mod opens the lobby, up to 30 players join by button, each turn gives 5 seconds to shoot — last officer standing wins.',
  commands: [russianroulette],
  events: [buttons],
};
