// Heist (M16.12) is a STAGED port.
//
// Slice A (S85): the rules engine — data tables, XP curve, pure resolver.
// Slice B (S86): storage + the `!heist` command surface, with lazy settlement.
// Slice C (S87): the restart-surviving scheduler — a finished job announces
//   itself, and a boot re-arms everything that was still running.
// Slice D (S88): crew robbery (4 officers, one shared roll) + the
//   owner-tunable job table, item prices and payout events. M16.12 complete.
import heist from './commands/heist.js';
import buttons from './events/buttons.js';
import ready from './events/ready.js';

export default {
  name: 'heist',
  description:
    'Heist (ported from maxcogs): the long-form crime economy — timed jobs, tools and shields, police heat, jail and bail, materials and crafting, levels 1–120.',
  commands: [heist],
  events: [ready, buttons],
};
