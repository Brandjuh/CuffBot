import splitorsteal from './commands/splitorsteal.js';
import buttons from './events/buttons.js';

export default {
  name: 'splitorsteal',
  description:
    'Split or Steal (ported from AAA3A-cogs): a 60-second open lobby, two randomly drawn contestants, one secret Split-or-Steal choice each — the classic trust dilemma.',
  commands: [splitorsteal],
  events: [buttons],
};
