import badge from './commands/badge.js';
import wanted from './commands/wanted.js';
import donut from './commands/donut.js';
import report911 from './commands/911.js';

export default {
  name: 'public-affairs',
  description:
    'Community & fun: /badge (member card), /wanted (playful poster), /donut, and /911 (report a member to the force).',
  commands: [badge, wanted, donut, report911],
  events: [],
};
