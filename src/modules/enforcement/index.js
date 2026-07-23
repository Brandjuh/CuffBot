import cite from './commands/cite.js';
import fine from './commands/fine.js';
import detain from './commands/detain.js';
import release from './commands/release.js';
import arrest from './commands/arrest.js';

export default {
  name: 'enforcement',
  description:
    'The arm of the law: citations (animated Papers-Please tickets), the for-fun /fine, detainment (timeouts), releases, and arrests (bans).',
  commands: [cite, fine, detain, release, arrest],
  events: [],
};
