// Heist (M16.12) is a STAGED port.
//
// Slice A (S85): the rules engine — data tables, XP curve, pure resolver.
// Slice B (S86): storage + the `!heist` command surface, with lazy settlement.
// Slice C (S87): the restart-surviving scheduler — a finished job announces
//   itself, and a boot re-arms everything that was still running.
// Slice D (S88): crew robbery (4 officers, one shared roll) + the
//   owner-tunable job table, item prices and payout events. M16.12 complete.
//
// M26.4a (S126): the four PLAYER-facing panels the S115 audit found missing —
// the job board, the shop, the equipment rack and the crafting bench. The two
// admin config panels and the event panel are 26.4b.
import heist from './commands/heist.js';
import buttons from './events/buttons.js';
import panels from './events/panels.js';
import ready from './events/ready.js';

export default {
  name: 'heist',
  description:
    'Heist (ported from maxcogs): the long-form crime economy — a panel-driven job board, shop, equipment rack and crafting bench, plus police heat, jail and bail, materials and levels 1–120.',
  commands: [heist],
  events: [ready, buttons, panels],
};
