import wordle from './commands/wordle.js';
import buttons from './events/buttons.js';
import watch from './events/watch.js';

export default {
  name: 'wordle',
  description:
    'Wordle (ported from AAA3A-cogs): guess the secret English word by typing guesses in the channel — 🟩 right spot, 🟨 in the word, ⬛ not in it. Lengths 4–11, attempts 5–10, per-member stats with a guess distribution.',
  commands: [wordle],
  events: [watch, buttons],
};
