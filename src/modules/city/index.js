// City (M16.13) is a STAGED port, following the shape that worked for heist.
//
// Slice A (S89): the crime tables, the 96 events and the pure resolver.
// Slice B: storage + the `!crime` command surface.
// Slice C: jail, bail and jailbreak + the 46 random scenarios.
// Slice D: the black market, the leaderboards and the admin surface.
//
// The manifest stays empty until there is something to run, so nothing
// half-wired can reach the precinct through the self-update timer.
export default {
  name: 'city',
  description:
    'City (ported from CalaMari-Cogs, staged): the crime underworld — pickpocketing, muggings, store jobs and bank heists with random events, streaks, fines and jail. Slice A: rules engine only, no commands yet.',
  commands: [],
  events: [],
};
