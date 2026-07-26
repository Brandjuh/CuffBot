import connect4 from './commands/minigames.js';
import buttons from './events/buttons.js';

export default {
  name: 'minigames',
  description:
    'Panel-driven minigames ported from the FireAndRescueAcademy `minigames` cog (M26.2): Connect 4 against an officer or the bot, played entirely on one message that the bot edits in place.',
  commands: [connect4],
  events: [buttons],
};
