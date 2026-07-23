import rapsheet from './commands/rapsheet.js';
import expunge from './commands/expunge.js';

export default {
  name: 'records',
  description:
    'The precinct archive: every enforcement action lands on a rap sheet with a case number; /rapsheet reads it, /expunge erases it.',
  commands: [rapsheet, expunge],
  events: [],
};
