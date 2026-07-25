import rollout from './commands/rollout.js';
import buttons from './events/buttons.js';

export default {
  name: 'rollout',
  description:
    'Rollout (ported from AAA3A-cogs): a big-lobby elimination game — every round, pick one of 25 numbers before the clock; the bot’s rolled number eliminates its pickers and the hesitant. Last one standing wins the prize.',
  commands: [rollout],
  events: [buttons],
};
