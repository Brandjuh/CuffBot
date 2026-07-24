import starboardConfig from './commands/starboard-config.js';
import starWatch from './events/star-watch.js';

export default {
  name: 'starboard',
  description:
    'The commendation board: react with enough ⭐ and the message is reposted to the configured board channel — community-curated highlights, each message boarded once.',
  commands: [starboardConfig],
  events: [starWatch],
};
