import memory from './commands/memory.js';
import buttons from './events/buttons.js';

export default {
  name: 'memory',
  description:
    'Memory (ported from AAA3A-cogs): single-player pair matching on a 3x3/4x4/5x5 button grid — mismatches flash red and hide again; a win pays a prize that decays with time and wrong matches.',
  commands: [memory],
  events: [buttons],
};
