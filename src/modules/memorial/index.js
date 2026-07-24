import memorialConfig from './commands/memorial-config.js';
import memorialSweep from './events/memorial-sweep.js';

export default {
  name: 'memorial',
  description:
    'Fallen-heroes tracker: polls the Fallen Firefighters (firehero.org) and Fallen Officers (odmp.org) feeds and honors new entries in the configured channel, tagging the matching role.',
  commands: [memorialConfig],
  events: [memorialSweep],
};
