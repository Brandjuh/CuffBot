import welcomeConfig from './commands/welcome-config.js';
import memberJoin from './events/member-join.js';

export default {
  name: 'welcome',
  description:
    'Front desk: greets every newcomer in the lobby with a themed welcome message. Needs the Server Members Intent (portal switch) to see joins.',
  commands: [welcomeConfig],
  events: [memberJoin],
};
