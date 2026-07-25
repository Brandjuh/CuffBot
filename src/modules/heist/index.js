// Heist (M16.12) is a STAGED port — this is slice A.
//
// Landed here: the cog's data tables (74 items, 28 recipes, 24 jobs), the
// XP curve, the pure resolver and crafting, all covered by test/heist.test.js.
// Deliberately NOT here yet: commands, buttons, storage and the
// restart-surviving timer scheduler — those are slices B and C, and the
// manifest stays empty until then so nothing half-wired reaches the precinct.
export default {
  name: 'heist',
  description:
    'Heist (ported from maxcogs, staged): the long-form crime economy — timed jobs, tools and shields, police heat, jail and bail, materials and crafting, levels 1–120. Slice A: rules engine only, no commands yet.',
  commands: [],
  events: [],
};
