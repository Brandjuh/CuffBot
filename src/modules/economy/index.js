import donuts from './commands/donuts.js';
import donutBoard from './commands/donut-board.js';
import economyConfig from './commands/economy-config.js';
import steal from './commands/steal.js';
import pot from './commands/pot.js';
import economyWatch from './events/economy-watch.js';

export default {
  name: 'economy',
  description:
    'The donut economy: everyone starts with 10k donuts, activity pays, crooks appear in busy channels (shout STOP POLICE), /steal risks a heist, and every lost donut lands in the daily-growing /pot.',
  commands: [donuts, donutBoard, economyConfig, steal, pot],
  events: [economyWatch],
};
