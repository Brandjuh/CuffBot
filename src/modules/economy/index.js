import donuts from './commands/donuts.js';
import donutBoard from './commands/donut-board.js';
import economyConfig from './commands/economy-config.js';
import economyWatch from './events/economy-watch.js';

export default {
  name: 'economy',
  description:
    'The donut economy: everyone starts with 10k donuts, activity pays, and crooks appear in busy channels — shout STOP POLICE in time to catch them, or they pickpocket a random member.',
  commands: [donuts, donutBoard, economyConfig],
  events: [economyWatch],
};
