import hangman from './commands/hangman.js';
import watch from './events/watch.js';

export default {
  name: 'hangman',
  description:
    'Hangman against the bot (ported from FlameCogs): the bot picks a word from the bundled 4,554-word list, you guess it one typed letter at a time before the gallows fill.',
  commands: [hangman],
  events: [watch],
};
