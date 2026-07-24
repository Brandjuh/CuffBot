import patrol from './commands/patrol.js';
import patrolRule from './commands/patrol-rule.js';
import patrolTerm from './commands/patrol-term.js';
import patrolWizard from './commands/patrol-wizard.js';
import patrolEvent from './events/patrol.js';
import wizardPump from './events/wizard.js';

export default {
  name: 'patrol',
  description:
    'Automated patrol (automod): screens messages for banned terms, invite links, and spam, and routes removals through records and the evidence locker. /patrol-wizard walks admins through setup.',
  commands: [patrol, patrolRule, patrolTerm, patrolWizard],
  events: [patrolEvent, wizardPump],
};
