import hunting from './commands/hunting.js';
import watch from './events/watch.js';
import reactions from './events/reactions.js';

export default {
  name: 'hunting',
  description:
    'The crook hunt (vrt-hunting port, precinct edition): crooks with their own shouts appear in the hunt channels at random intervals — shout STOP POLICE (or press 🚨) to cuff them for donuts, salute the undercover officer, and climb the arrest leaderboard.',
  commands: [hunting],
  events: [watch, reactions],
};
