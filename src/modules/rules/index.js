import rules from './commands/rules.js';

export default {
  name: 'rules',
  description:
    'The precinct rulebook: admins write numbered rules, the bot keeps one tidy published post current by editing it in place.',
  commands: [rules],
  events: [],
};
