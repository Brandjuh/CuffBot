import goal from './commands/goal.js';
import ready from './events/ready.js';

export default {
  name: 'goals',
  description:
    'Goal tracker: precinct-wide targets with progress bars and milestone announcements, plus personal goals and a board.',
  commands: [goal],
  events: [ready],
};
