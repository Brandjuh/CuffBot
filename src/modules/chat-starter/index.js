import chatStarterConfig from './commands/chat-starter-config.js';
import activityWatch from './events/activity-watch.js';
import starterSweep from './events/starter-sweep.js';

export default {
  name: 'chat-starter',
  description:
    'Chat starter: when the configured channel goes quiet for too long, CuffBot posts an open-ended question (list-based, optionally AI-generated) to get the precinct talking again.',
  commands: [chatStarterConfig],
  events: [activityWatch, starterSweep],
};
