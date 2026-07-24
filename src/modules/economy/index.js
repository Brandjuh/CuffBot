import donuts from './commands/donuts.js';
import donutBoard from './commands/donut-board.js';
import economyConfig from './commands/economy-config.js';
import steal from './commands/steal.js';
import economyWatch from './events/economy-watch.js';

export default {
  name: 'economy',
  description:
    'The donut economy: everyone starts with 10k donuts, activity pays, crooks appear in busy channels (shout STOP POLICE), and /steal risks a heist on a fellow officer.',
  commands: [donuts, donutBoard, economyConfig, steal],
  events: [economyWatch],
};
