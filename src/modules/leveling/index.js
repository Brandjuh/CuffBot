import level from './commands/level.js';
import leaderboard from './commands/leaderboard.js';
import xpConfig from './commands/xp-config.js';
import messageXp from './events/message-xp.js';
import voiceSweep from './events/voice-sweep.js';

export default {
  name: 'leveling',
  description:
    'CuffBot’s own XP system (replaces the old leveler bot): messages and voice time earn XP, ranks from the academy ladder are auto-assigned (promote-only). Existing members are seeded from the rank they already hold.',
  commands: [level, leaderboard, xpConfig],
  events: [messageXp, voiceSweep],
};
