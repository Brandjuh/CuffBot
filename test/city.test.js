// City slice A (S89 = M16.13, CalaMari port): the crime table, the 96 events
// as dumped from the source, and the pure resolver — event draw, modifier
// pipeline, streaks, the cog's step-by-step rounding, fines and sentences.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRIMES,
  DEFAULT_CITY_SETTINGS,
  EVENT_CHANCES,
  STREAK_WINDOW_MS,
  crimeEvents,
  eventsFor,
} from '../src/modules/city/lib/tables.js';
import {
  applyEvents,
  bailCost,
  crimeCooldownLeft,
  drawEvents,
  jailLeft,
  nextStreak,
  resolveCrime,
  stolenAmount,
  streakBonus,
} from '../src/modules/city/lib/resolve.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 1_800_000_000_000;

/** Scripted rng; exhausting a queue throws, so call ORDER is pinned too. */
function scriptRng({ ints = [], floats = [], uniforms = [], picks = [] } = {}) {
  const take = (queue, what) => {
    if (queue.length === 0) throw new Error(`rng.${what} exhausted`);
    return queue.shift();
  };
  return {
    int: () => take(ints, 'int'),
    float: () => take(floats, 'float'),
    uniform: () => take(uniforms, 'uniform'),
    pick: (list) => {
      const index = take(picks, 'pick');
      return list[index];
    },
  };
}

const member = (over = {}) => ({ streak: 0, highest: 0, lastCrimeAt: NOW, balance: 100_000, ...over });

// ── the tables ───────────────────────────────────────────────────────────────

test('the five crimes carry the cog values', () => {
  assert.deepEqual(Object.keys(CRIMES), ['pickpocket', 'mugging', 'rob_store', 'bank_heist', 'random']);
  assert.equal(CRIMES.pickpocket.successRate, 0.6);
  assert.equal(CRIMES.pickpocket.cooldownMs, 10 * MINUTE);
  assert.equal(CRIMES.pickpocket.jailMs, 1 * HOUR);
  assert.equal(CRIMES.bank_heist.maxReward, 5000);
  assert.equal(CRIMES.bank_heist.cooldownMs, 24 * HOUR);
  assert.equal(CRIMES.rob_store.fineMultiplier, 0.4, "the cog's comment says 45% — its value says 40%");
  // Only the two person-crimes steal from a victim.
  assert.deepEqual(
    Object.entries(CRIMES).filter(([, crime]) => crime.requiresTarget).map(([name]) => name),
    ['pickpocket', 'mugging'],
  );
});

test('the 96 events came out of the source intact', () => {
  const events = crimeEvents();
  assert.deepEqual(Object.keys(events), ['pickpocket', 'mugging', 'rob_store', 'bank_heist']);
  assert.equal(Object.values(events).reduce((n, list) => n + list.length, 0), 96);
  const known = new Set(['text', 'chance_bonus', 'chance_penalty', 'reward_multiplier', 'jail_multiplier', 'credits_bonus', 'credits_penalty']);
  for (const [crime, list] of Object.entries(events)) {
    assert.equal(list.length, 24, `${crime} has 24 events`);
    for (const event of list) {
      assert.ok(event.text, 'every event has display text');
      const keys = Object.keys(event);
      assert.ok(keys.every((key) => known.has(key)), `${crime}: unexpected key in ${keys}`);
      assert.ok(keys.length > 1, 'every event does something');
    }
  }
  assert.deepEqual(eventsFor('random'), [], 'the scenario crime has no event pool of its own');
  assert.deepEqual(EVENT_CHANCES, [1, 0.75, 0.5, 0.1]);
});

// ── the event draw ───────────────────────────────────────────────────────────

test('the first event is guaranteed and the rest roll 75/50/10, without repeats', () => {
  // All three optional rolls succeed → four distinct events.
  const four = drawEvents('pickpocket', scriptRng({ floats: [0.5, 0.4, 0.05], picks: [0, 0, 0, 0] }));
  assert.equal(four.length, 4);
  assert.equal(new Set(four.map((event) => event.text)).size, 4, 'drawn without replacement');

  // Only the guaranteed one when every optional roll fails.
  const one = drawEvents('pickpocket', scriptRng({ floats: [0.99, 0.99, 0.99], picks: [3] }));
  assert.equal(one.length, 1);
  assert.equal(one[0], eventsFor('pickpocket')[3], 'pick indexes into the remaining pool');

  // Boundary: 0.75 is NOT < 0.75, so the second event is skipped.
  assert.equal(drawEvents('pickpocket', scriptRng({ floats: [0.75, 0.99, 0.99], picks: [0] })).length, 1);
  assert.equal(drawEvents('random', scriptRng({})).length, 0, 'no pool, no draws, no rng calls');
});

test('event modifiers fold with the cog clamps', () => {
  const folded = applyEvents(
    [
      { text: 'a', chance_bonus: 0.15 },
      { text: 'b', chance_penalty: 0.2, reward_multiplier: 1.3 },
      { text: 'c', jail_multiplier: 0.8 },
      { text: 'd', credits_bonus: 100 },
      { text: 'e', credits_penalty: 75 },
    ],
    { successChance: 0.6, jailMs: 3600_000 },
  );
  assert.ok(Math.abs(folded.successChance - 0.55) < 1e-9, '+0.15 then −0.20');
  assert.equal(folded.jailMs, 2_880_000, 'int(3600000 × 0.8)');
  assert.equal(folded.jailMultiplier, 0.8);
  assert.equal(folded.creditChange, 25, '+100 −75');

  const ceiling = applyEvents([{ text: 'x', chance_bonus: 0.9 }], { successChance: 0.6, jailMs: 0 });
  assert.equal(ceiling.successChance, 1.0, 'clamped at certainty');
  const floor = applyEvents([{ text: 'x', chance_penalty: 0.9 }], { successChance: 0.6, jailMs: 0 });
  assert.ok(Math.abs(floor.successChance - 0.05) < 1e-9, 'never below the 5% floor');
});

// ── streaks ──────────────────────────────────────────────────────────────────

test('the streak pays 5% a step up to 25%, and dies after 24 idle hours', () => {
  assert.equal(streakBonus(0), 1.0);
  assert.equal(streakBonus(1), 1.05);
  assert.equal(streakBonus(5), 1.25);
  assert.equal(streakBonus(50), 1.25, 'capped');

  const up = nextStreak({ streak: 2, highest: 3, lastCrimeAt: NOW - HOUR }, true, NOW);
  assert.deepEqual([up.streak, up.highest, up.multiplier], [3, 3, 1.15]);
  const record = nextStreak({ streak: 3, highest: 3, lastCrimeAt: NOW }, true, NOW);
  assert.equal(record.highest, 4, 'a new personal best is kept');
  const lost = nextStreak({ streak: 4, highest: 9, lastCrimeAt: NOW }, false, NOW);
  assert.deepEqual([lost.streak, lost.highest, lost.multiplier], [0, 9, 1.0], 'failure resets, the record stands');
  const stale = nextStreak({ streak: 4, highest: 4, lastCrimeAt: NOW - STREAK_WINDOW_MS - 1 }, true, NOW);
  assert.equal(stale.streak, 1, 'a day away wipes it before the success counts');
});

// ── stealing ─────────────────────────────────────────────────────────────────

test('a targeted crime takes a capped slice of the victim, floored at the minimum', () => {
  const rich = stolenAmount(CRIMES.mugging, 100_000, DEFAULT_CITY_SETTINGS, scriptRng({ uniforms: [0.2] }));
  assert.equal(rich, 1000, 'int(100000 × 0.2) = 20000, capped by maxStealAmount 1000');

  const modest = stolenAmount(CRIMES.pickpocket, 8000, { ...DEFAULT_CITY_SETTINGS, maxStealAmount: 5000 }, scriptRng({ uniforms: [0.05] }));
  assert.equal(modest, 400, 'int(8000 × 0.05), under both caps');

  const poor = stolenAmount(CRIMES.pickpocket, 1000, DEFAULT_CITY_SETTINGS, scriptRng({ uniforms: [0.01] }));
  assert.equal(poor, 10, 'too poor for the floor to apply (needs 15,000 at 1%)');

  const floored = stolenAmount(CRIMES.pickpocket, 20_000, DEFAULT_CITY_SETTINGS, scriptRng({ uniforms: [0.001] }));
  assert.equal(floored, 150, 'a rich victim always yields at least min_reward');

  const flat = stolenAmount(CRIMES.bank_heist, 0, DEFAULT_CITY_SETTINGS, scriptRng({ ints: [3000] }));
  assert.equal(flat, 3000, 'untargeted crimes just draw their range');
});

// ── whole attempts ───────────────────────────────────────────────────────────

test('a successful heist rounds after the streak AND after each event multiplier', () => {
  const outcome = resolveCrime(
    {
      crimeType: 'bank_heist',
      crime: CRIMES.bank_heist,
      member: member({ streak: 2 }),
      now: NOW,
      // one event (all optional rolls fail), the success roll, the reward draw
    },
    scriptRng({ floats: [0.99, 0.99, 0.99, 0.1], picks: [0], ints: [3333] }),
  );
  assert.equal(outcome.success, true);
  assert.equal(outcome.baseAmount, 3333);
  assert.equal(outcome.streak.streak, 3);
  // 3333 × 1.15 = 3832.95 → 3833, then the drawn event's own multiplier.
  const afterStreak = Math.round(3333 * 1.15);
  assert.equal(afterStreak, 3833);
  assert.equal(outcome.steps[1].amount, 3833);
  const drawn = outcome.events[0];
  const expected = 'reward_multiplier' in drawn ? Math.round(3833 * drawn.reward_multiplier) : 3833;
  assert.equal(outcome.payout, expected + outcome.creditChange);
  assert.equal(outcome.jailMs, 0, 'nobody goes to jail on a win');
  assert.equal(outcome.fine, 0);
});

test('a failed heist fines a share of the ceiling and jails for the folded time', () => {
  const outcome = resolveCrime(
    { crimeType: 'rob_store', crime: CRIMES.rob_store, member: member(), now: NOW },
    // no events at all (every optional roll fails, first is forced), then the
    // success roll fails.
    scriptRng({ floats: [0.99, 0.99, 0.99, 0.99], picks: [0] }),
  );
  assert.equal(outcome.success, false);
  assert.equal(outcome.fine, 800, 'int(2000 × 0.4)');
  assert.equal(outcome.finePaid, 800);
  assert.equal(outcome.brokeAndDoubled, false);
  assert.equal(outcome.streak.streak, 0, 'a failure resets the streak');
  const drawn = outcome.events[0];
  const expectedJail = 'jail_multiplier' in drawn ? Math.trunc(3 * HOUR * drawn.jail_multiplier) : 3 * HOUR;
  assert.equal(outcome.jailMs, expectedJail);
});

test('a broke crook loses everything and serves double', () => {
  const outcome = resolveCrime(
    { crimeType: 'bank_heist', crime: CRIMES.bank_heist, member: member({ balance: 300 }), now: NOW },
    scriptRng({ floats: [0.99, 0.99, 0.99, 0.99], picks: [0] }),
  );
  assert.equal(outcome.success, false);
  assert.equal(outcome.fine, 2000, 'int(5000 × 0.4)');
  assert.equal(outcome.finePaid, 300, 'everything they had');
  assert.equal(outcome.brokeAndDoubled, true);
  const drawn = outcome.events[0];
  const base = 'jail_multiplier' in drawn ? Math.trunc(4 * HOUR * drawn.jail_multiplier) : 4 * HOUR;
  assert.equal(outcome.jailMs, base * 2, 'the sentence doubles');
});

test('a targeted success reports what came out of the victim separately', () => {
  const outcome = resolveCrime(
    {
      crimeType: 'pickpocket',
      crime: CRIMES.pickpocket,
      member: member(),
      targetBalance: 50_000,
      now: NOW,
    },
    scriptRng({ floats: [0.99, 0.99, 0.99, 0.1], picks: [6], uniforms: [0.02] }),
  );
  assert.equal(outcome.success, true);
  // int(50000 × 0.02) = 1000, capped by maxStealAmount 1000 and then by
  // pickpocket's own maxReward of 500; the first success gives a 1.05 streak.
  assert.equal(outcome.baseAmount, 500);
  assert.equal(outcome.steps[1].amount, 525);
  // Event index 6 is the dropped-wallet find (+100).
  assert.equal(outcome.creditChange, 100);
  assert.equal(outcome.payout, 625);
  assert.equal(outcome.stolenFromTarget, 625, 'the cog withdraws the WHOLE transfer from the victim');
});

// ── cooldowns, jail, bail ────────────────────────────────────────────────────

test('cooldowns, jail time and bail all measure from the stored stamps', () => {
  assert.equal(crimeCooldownLeft({}, 'pickpocket', NOW), 0, 'never attempted');
  assert.equal(crimeCooldownLeft({ pickpocket: NOW }, 'pickpocket', NOW), 10 * MINUTE);
  assert.equal(crimeCooldownLeft({ pickpocket: NOW }, 'pickpocket', NOW + 11 * MINUTE), 0);
  assert.equal(crimeCooldownLeft({ pickpocket: NOW }, 'pickpocket', NOW, 60_000), 60_000, 'an override wins');

  assert.equal(jailLeft({}, NOW), 0);
  assert.equal(jailLeft({ jailMs: HOUR, jailStartedAt: NOW }, NOW + 20 * MINUTE), 40 * MINUTE);
  assert.equal(jailLeft({ jailMs: HOUR, jailStartedAt: NOW }, NOW + 2 * HOUR), 0, 'served');

  assert.equal(bailCost(30 * MINUTE), 48, 'int(1.6 × 30)');
  assert.equal(bailCost(90_000), 2, "int(1.6 × 1.5) — the cog keeps the minutes fractional, so it is 2 and not 3");
  assert.equal(bailCost(0), 0);
});
