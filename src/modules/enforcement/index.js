import cite from './commands/cite.js';
import detain from './commands/detain.js';
import release from './commands/release.js';
import arrest from './commands/arrest.js';

export default {
  name: 'enforcement',
  description:
    'The arm of the law: citations (with Papers-Please-style tickets), detainment (timeouts), releases, and arrests (bans).',
  commands: [cite, detain, release, arrest],
  events: [],
};
