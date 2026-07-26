import donuts from './commands/donuts.js';
import economyConfig from './commands/economy.js';
import steal from './commands/steal.js';
import pot from './commands/pot.js';
import daily from './commands/daily.js';
import claims from './commands/claims.js';
import economyWatch from './events/economy-watch.js';

export default {
  name: 'economy',
  description:
    'The donut economy: everyone starts with 10k donuts, /daily and the payday-style /claims pay out on schedule, activity pays, /steal risks a heist, and every lost donut lands in the daily-growing /pot (the crook hunt lives in the hunting module since S66).',
  commands: [donuts, economyConfig, steal, pot, daily, claims],
  events: [economyWatch],
};
