// City (M16.13) is a STAGED port, following the shape that worked for heist.
//
// Slice A (S89): the crime tables, the 96 events and the pure resolver.
// Slice B (S90): storage + the `!crime` command surface.
// Slice C: jail, bail and jailbreak + the 46 random scenarios.
// Slice D: the black market, the leaderboards and the admin surface.
//
import crime from './commands/crime.js';

export default {
  name: 'city',
  description:
    'City (ported from CalaMari-Cogs): the crime underworld — pickpocketing, muggings, store jobs and bank heists with random events, streaks, fines and jail.',
  commands: [crime],
  events: [],
};
