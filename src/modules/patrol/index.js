import patrol from './commands/patrol.js';
import patrolRule from './commands/patrol-rule.js';
import patrolTerm from './commands/patrol-term.js';
import patrolEvent from './events/patrol.js';

export default {
  name: 'patrol',
  description:
    'Automated patrol (automod): screens messages for banned terms, invite links, and spam, and routes removals through records and the evidence locker.',
  commands: [patrol, patrolRule, patrolTerm],
  events: [patrolEvent],
};
