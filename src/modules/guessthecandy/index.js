import guessthecandy from './commands/guessthecandy.js';
import buttons from './events/buttons.js';

export default {
  name: 'guessthecandy',
  description:
    'Guess the Candy (ported from AAA3A-cogs): a speed round — the scrambled candy name on screen, 5–23 name buttons, first correct press wins on the clock.',
  commands: [guessthecandy],
  events: [buttons],
};
