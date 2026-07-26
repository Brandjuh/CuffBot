import connect4 from './commands/connect4.js';
import tictactoe from './commands/tictactoe.js';
import { gameLeaderboardCommand, minigamesGroup } from './commands/minigames.js';
import buttons from './events/buttons.js';

export default {
  name: 'minigames',
  description:
    'Panel-driven minigames ported from the FireAndRescueAcademy `minigames` cog (M26.2): Connect 4 and Tic-Tac-Toe against an officer or the bot, played entirely on one message the bot edits in place, staked in donuts and pooled into one leaderboard.',
  commands: [connect4, tictactoe, minigamesGroup, gameLeaderboardCommand],
  events: [buttons],
};
