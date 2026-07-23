import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_XP_CONFIG,
  achievedRanks,
  eligibleVoiceMemberIds,
  levelProgress,
  messageXpGain,
  planRankSync,
  seedXpForRankIndex,
  targetRank,
  thresholdsFor,
  voiceXpGain,
} from '../src/modules/leveling/lib/xp.js';

// A 4-rank ladder, highest-first like academy's buildLadder produces.
const LADDER = {
  ranks: [
    { roleId: 'r-legend', name: 'Legend' },
    { roleId: 'r-veteran', name: 'Veteran' },
    { roleId: 'r-regular', name: 'Regular' },
    { roleId: 'r-rookie', name: 'Rookie' },
  ],
};

test('messageXpGain awards outside the cooldown and 0 inside it', () => {
  const cfg = { messageXp: 15, messageCooldownMs: 60_000 };
  assert.equal(messageXpGain(cfg, null, 1_000_000), 15); // never seen
  assert.equal(messageXpGain(cfg, 1_000_000, 1_030_000), 0); // 30s later
  assert.equal(messageXpGain(cfg, 1_000_000, 1_060_000), 15); // exactly at cooldown
});

test('voiceXpGain pays whole minutes only and never negative', () => {
  const cfg = { voiceXpPerMin: 10 };
  assert.equal(voiceXpGain(cfg, 60_000), 10);
  assert.equal(voiceXpGain(cfg, 59_999), 0);
  assert.equal(voiceXpGain(cfg, 150_000), 20);
  assert.equal(voiceXpGain(cfg, -5_000), 0);
});

test('thresholdsFor grows superlinearly, lowest rank first', () => {
  const t = thresholdsFor(4, { baseXp: 100, exponent: 1.6 });
  assert.equal(t.length, 4);
  assert.equal(t[0], 100);
  assert.ok(t[1] > 2 * t[0], 'second rank costs more than double the first');
  for (let i = 1; i < t.length; i += 1) assert.ok(t[i] > t[i - 1]);
});

test('achievedRanks counts thresholds reached from the bottom', () => {
  const t = [100, 300, 580];
  assert.equal(achievedRanks(0, t), 0);
  assert.equal(achievedRanks(99, t), 0);
  assert.equal(achievedRanks(100, t), 1);
  assert.equal(achievedRanks(579, t), 2);
  assert.equal(achievedRanks(10_000, t), 3);
});

test('targetRank maps XP onto the highest-first ladder', () => {
  const cfg = { baseXp: 100, exponent: 1.6 };
  assert.equal(targetRank(0, LADDER, cfg), null); // below the lowest rank
  assert.equal(targetRank(100, LADDER, cfg).roleId, 'r-rookie');
  const t = thresholdsFor(4, cfg);
  assert.equal(targetRank(t[3], LADDER, cfg).roleId, 'r-legend');
  assert.equal(targetRank(t[3] * 10, LADDER, cfg).roleId, 'r-legend'); // clamps at top
});

test('targetRank on an empty ladder is null', () => {
  assert.equal(targetRank(1_000, { ranks: [] }), null);
});

// ---- seeding: existing members are coupled to the rank they already hold ----

test('seedXpForRankIndex gives the floor XP of the held rank', () => {
  const cfg = { baseXp: 100, exponent: 1.6 };
  const t = thresholdsFor(4, cfg);
  // Bottom rank (index 3 on a highest-first ladder of 4) seeds at t[0].
  assert.equal(seedXpForRankIndex(3, 4, cfg), t[0]);
  // Top rank (index 0) seeds at t[3].
  assert.equal(seedXpForRankIndex(0, 4, cfg), t[3]);
  assert.equal(seedXpForRankIndex(2, 4, cfg), t[1]);
});

test('seedXpForRankIndex: no rank or broken input seeds 0 (new members)', () => {
  assert.equal(seedXpForRankIndex(-1, 4), 0);
  assert.equal(seedXpForRankIndex(0, 0), 0);
  assert.equal(seedXpForRankIndex(5, 4), 0); // out of range
});

test('seeded XP keeps exactly the held rank — no instant promotion or demotion', () => {
  const cfg = { baseXp: 100, exponent: 1.6 };
  for (let idx = 0; idx < 4; idx += 1) {
    const seeded = seedXpForRankIndex(idx, 4, cfg);
    assert.equal(targetRank(seeded, LADDER, cfg).roleId, LADDER.ranks[idx].roleId);
  }
});

// ---- voice eligibility (anti-farm) ----

test('voice XP needs at least two humans in the channel', () => {
  assert.deepEqual(eligibleVoiceMemberIds([{ id: 'a' }]), []);
  assert.deepEqual(eligibleVoiceMemberIds([{ id: 'a' }, { id: 'bot', bot: true }]), []);
  assert.deepEqual(eligibleVoiceMemberIds([{ id: 'a' }, { id: 'b' }]), ['a', 'b']);
});

test('self-deafened members earn nothing but still count as present', () => {
  const ids = eligibleVoiceMemberIds([{ id: 'a' }, { id: 'b', selfDeaf: true }]);
  assert.deepEqual(ids, ['a']); // b is present (so a is not alone) but earns nothing
});

test('the AFK channel never pays voice XP', () => {
  assert.deepEqual(eligibleVoiceMemberIds([{ id: 'a' }, { id: 'b' }], { isAfkChannel: true }), []);
});

// ---- promote-only rank sync ----

test('planRankSync promotes up to the earned rank and swaps lower rank roles', () => {
  const cfg = { baseXp: 100, exponent: 1.6 };
  const t = thresholdsFor(4, cfg);
  const plan = planRankSync(['r-rookie'], LADDER, t[1], cfg); // XP earns Regular
  assert.equal(plan.changed, true);
  assert.equal(plan.addRoleId, 'r-regular');
  assert.deepEqual(plan.removeRoleIds, ['r-rookie']);
  assert.equal(plan.fromName, 'Rookie');
  assert.equal(plan.toName, 'Regular');
});

test('planRankSync gives a first rank to a rankless member', () => {
  const plan = planRankSync([], LADDER, 100, { baseXp: 100, exponent: 1.6 });
  assert.equal(plan.changed, true);
  assert.equal(plan.addRoleId, 'r-rookie');
  assert.equal(plan.fromName, null);
});

test('planRankSync NEVER demotes: held rank above earned rank is a no-op', () => {
  // Member holds Veteran but XP only earns Rookie (e.g. manually promoted).
  const plan = planRankSync(['r-veteran'], LADDER, 100, { baseXp: 100, exponent: 1.6 });
  assert.equal(plan.changed, false);
});

test('planRankSync is a no-op when the earned rank is already held', () => {
  const plan = planRankSync(['r-rookie'], LADDER, 150, { baseXp: 100, exponent: 1.6 });
  assert.equal(plan.changed, false);
});

test('planRankSync is a no-op below the lowest threshold or on an empty ladder', () => {
  assert.equal(planRankSync([], LADDER, 50, { baseXp: 100, exponent: 1.6 }).changed, false);
  assert.equal(planRankSync([], { ranks: [] }, 5_000).changed, false);
});

// ---- level card math ----

test('levelProgress reports floor, next threshold, and distance', () => {
  const cfg = { baseXp: 100, exponent: 1.6 };
  const t = thresholdsFor(4, cfg);
  const p = levelProgress(t[0] + 10, 4, cfg);
  assert.equal(p.achieved, 1);
  assert.equal(p.currentFloor, t[0]);
  assert.equal(p.nextThreshold, t[1]);
  assert.equal(p.xpIntoRank, 10);
  assert.equal(p.xpForNext, t[1] - (t[0] + 10));
});

test('levelProgress at the top of the ladder has no next threshold', () => {
  const cfg = { baseXp: 100, exponent: 1.6 };
  const t = thresholdsFor(4, cfg);
  const p = levelProgress(t[3] + 500, 4, cfg);
  assert.equal(p.achieved, 4);
  assert.equal(p.nextThreshold, null);
  assert.equal(p.xpForNext, null);
});

test('DEFAULT_XP_CONFIG values are sane for a small community', () => {
  assert.ok(DEFAULT_XP_CONFIG.messageXp > 0);
  assert.ok(DEFAULT_XP_CONFIG.messageCooldownMs >= 10_000, 'cooldown stops spam-farming');
  assert.ok(DEFAULT_XP_CONFIG.voiceXpPerMin > 0);
  assert.ok(DEFAULT_XP_CONFIG.exponent > 1, 'higher ranks must cost progressively more');
});
