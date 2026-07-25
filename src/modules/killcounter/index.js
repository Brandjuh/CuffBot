import killcounter from './commands/killcounter.js';
import messageWatch from './events/message.js';

export default {
  name: 'killcounter',
  description:
    'Chat kills: when a channel goes quiet after someone speaks, the last word scores a point. Includes a leaderboard.',
  commands: [killcounter],
  events: [messageWatch],
};
