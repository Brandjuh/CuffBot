import connect4 from './commands/connect4.js';
import buttons from './events/buttons.js';

export default {
  name: 'connect4',
  description:
    'Connect 4 duels (ported from phen-cogs): challenge an officer, drop pieces with buttons on a 7×6 emoji board, four in a row wins — with a precinct scoreboard.',
  commands: [connect4],
  events: [buttons],
};
