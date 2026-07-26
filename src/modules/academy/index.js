import promote from './commands/promote.js';
import demote from './commands/demote.js';
import ranks from './commands/ranks.js';

export default {
  name: 'academy',
  description:
    'The academy: adopts the server’s own rank roles (e.g. an existing leveler ladder) for /promote, /demote, /ranks, with /rank-setup and /rank-exclude to configure detection.',
  commands: [promote, demote, ranks],
  events: [],
};
