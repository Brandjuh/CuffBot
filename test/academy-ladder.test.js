import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLadder,
  currentRank,
  currentRankIndex,
  isSectionDivider,
  planDemotion,
  planPromotion,
} from '../src/modules/academy/lib/ladder.js';

// A realistic role list ordered highest position first: some staff/cosmetic
// roles, the [LEVELER] header, then the rank roles high→low, then two non-rank
// roles under the section, then @everyone.
const ROLES = [
  { id: 'admin', name: 'Admin', position: 100 },
  { id: 'booster', name: 'Server Booster', position: 90, managed: true },
  { id: 'lvl-header', name: '▬▬ LEVELER ▬▬', position: 80 },
  { id: 'r-legend', name: 'Legend', position: 79 },
  { id: 'r-veteran', name: 'Veteran', position: 78 },
  { id: 'r-regular', name: 'Regular', position: 77 },
  { id: 'r-rookie', name: 'Rookie', position: 76 },
  { id: 'excluded-a', name: 'Muted', position: 75 },
  { id: 'excluded-b', name: 'DJ', position: 74 },
  { id: 'everyone', name: '@everyone', position: 0 },
];

const CONFIG = { headerRoleId: 'lvl-header', excludedRoleIds: ['excluded-a', 'excluded-b'] };

test('isSectionDivider recognizes header-style names', () => {
  assert.equal(isSectionDivider('▬▬ LEVELER ▬▬'), true);
  assert.equal(isSectionDivider('[STAFF]'), true);
  assert.equal(isSectionDivider('Sergeant'), false);
});

test('buildLadder detects the ranks under the header, excluding noise', () => {
  const ladder = buildLadder(ROLES, CONFIG);
  assert.equal(ladder.headerFound, true);
  assert.deepEqual(
    ladder.ranks.map((r) => r.name),
    ['Legend', 'Veteran', 'Regular', 'Rookie'],
  );
  // booster (managed) is above the header anyway; excluded + @everyone dropped.
});

test('buildLadder can auto-detect the header by name when not configured', () => {
  const ladder = buildLadder(ROLES, { excludedRoleIds: ['excluded-a', 'excluded-b'] });
  assert.equal(ladder.headerFound, true);
  assert.equal(ladder.ranks[0].name, 'Legend');
});

test('buildLadder reports no ladder when there is no header', () => {
  const ladder = buildLadder([{ id: 'x', name: 'Member' }], {});
  assert.equal(ladder.headerFound, false);
  assert.deepEqual(ladder.ranks, []);
});

test('currentRank picks the highest held rank (lowest index)', () => {
  const ladder = buildLadder(ROLES, CONFIG);
  assert.equal(currentRank(['r-regular', 'r-rookie'], ladder).name, 'Regular');
  assert.equal(currentRankIndex(['r-legend'], ladder), 0);
  assert.equal(currentRank(['nothing'], ladder), null);
});

test('planPromotion inducts a rankless member at the lowest rank', () => {
  const ladder = buildLadder(ROLES, CONFIG);
  const plan = planPromotion(ladder, [], null);
  assert.equal(plan.ok, true);
  assert.equal(plan.from, null);
  assert.equal(plan.to, 'Rookie');
  assert.equal(plan.addRoleId, 'r-rookie');
});

test('planPromotion moves one rung up and swaps the rank role', () => {
  const ladder = buildLadder(ROLES, CONFIG);
  const plan = planPromotion(ladder, ['r-regular'], null); // Regular → Veteran
  assert.equal(plan.to, 'Veteran');
  assert.equal(plan.addRoleId, 'r-veteran');
  assert.deepEqual(plan.removeRoleIds, ['r-regular']);
});

test('planPromotion jumps straight to a higher rank and rejects non-promotions', () => {
  const ladder = buildLadder(ROLES, CONFIG);
  const up = planPromotion(ladder, ['r-rookie'], 'r-legend');
  assert.equal(up.to, 'Legend');
  assert.deepEqual(up.removeRoleIds, ['r-rookie']);

  assert.equal(planPromotion(ladder, ['r-legend'], null).code, 'already-top');
  assert.equal(planPromotion(ladder, ['r-veteran'], 'r-regular').code, 'target-not-higher');
  assert.equal(planPromotion(ladder, [], 'not-a-rank').code, 'unknown-rank');
  assert.equal(planPromotion(buildLadder([{ id: 'x', name: 'Member' }], {}), [], null).code, 'ladder-unconfigured');
});

test('planDemotion moves down and rejects the impossible cases', () => {
  const ladder = buildLadder(ROLES, CONFIG);
  const down = planDemotion(ladder, ['r-veteran'], null); // Veteran → Regular
  assert.equal(down.to, 'Regular');
  assert.equal(down.addRoleId, 'r-regular');
  assert.deepEqual(down.removeRoleIds, ['r-veteran']);

  assert.equal(planDemotion(ladder, ['r-rookie'], null).code, 'already-bottom');
  assert.equal(planDemotion(ladder, [], null).code, 'no-rank-to-demote');
  assert.equal(planDemotion(ladder, ['r-regular'], 'r-legend').code, 'target-not-lower');
});
