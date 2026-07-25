// City slice B (S90 = M16.13, CalaMari port): the criminal record, the cog's
// gates, the money movement (including the victim clamp) and the group shape.
// The pure engine itself lives in test/city.test.js.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { CRIMES } from '../src/modules/city/lib/tables.js';
import {
  canAttempt,
  commitCrime,
  cooldownFor,
  getCitySettings,
  getCriminal,
  jailState,
  setCitySettings,
  topCriminals,
  updateCriminal,
} from '../src/modules/city/service.js';
import crimeCommand, { crimeEmbed } from '../src/modules/city/commands/crime.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-city-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const NOW = 1_800_000_000_000;
let seq = 0;
const freshGuildId = () => `90000000000000${String((seq += 1)).padStart(4, '0')}`;

const { balanceOf, adjustBalance } = await import('../src/modules/economy/service.js');

function scriptRng({ ints = [], floats = [], uniforms = [], picks = [] } = {}) {
  const take = (queue, what) => {
    if (queue.length === 0) throw new Error(`rng.${what} exhausted`);
    return queue.shift();
  };
  return {
    int: () => take(ints, 'int'),
    float: () => take(floats, 'float'),
    uniform: () => take(uniforms, 'uniform'),
    pick: (list) => list[take(picks, 'pick')],
  };
}

/** No events at all, then the success/failure roll. */
const noEvents = (successRoll, extra = {}) =>
  scriptRng({ floats: [0.99, 0.99, 0.99, successRoll], picks: [0], ...extra });

// ── the record ───────────────────────────────────────────────────────────────

test('a fresh criminal is fully shaped and writes round-trip', () => {
  const guildId = freshGuildId();
  const criminal = getCriminal(guildId, 'alice');
  assert.deepEqual(criminal.cooldowns, {});
  assert.equal(criminal.jailMs, 0);
  assert.equal(criminal.streak, 0);
  assert.deepEqual(criminal.stats.successes, 0);

  updateCriminal(guildId, 'alice', (c) => ({ ...c, streak: 3, stats: { ...c.stats, earned: 500 } }));
  const stored = getCriminal(guildId, 'alice');
  assert.equal(stored.streak, 3);
  assert.equal(stored.stats.earned, 500);
  assert.equal(stored.stats.finesPaid, 0, 'untouched stats keep their defaults');
});

test('guild settings layer over the cog defaults', () => {
  const guildId = freshGuildId();
  assert.equal(getCitySettings(guildId).bailCostMultiplier, 1.6);
  assert.equal(getCitySettings(guildId).maxStealAmount, 1000);
  setCitySettings(guildId, { maxStealAmount: 250 });
  assert.equal(getCitySettings(guildId).maxStealAmount, 250);
  assert.equal(getCitySettings(guildId).minStealBalance, 100, 'the rest stay default');
});

// ── the gates, in the cog's order ────────────────────────────────────────────

test('jail blocks everything, cooldowns block one crime, and both report their clock', () => {
  const guildId = freshGuildId();
  const jailed = { ...getCriminal(guildId, 'alice'), jailMs: HOUR, jailStartedAt: NOW };
  const gate = canAttempt(guildId, jailed, 'bank_heist', { now: NOW + 10 * MINUTE });
  assert.equal(gate.reason, 'jailed');
  assert.equal(gate.remainingMs, 50 * MINUTE);
  assert.equal(canAttempt(guildId, jailed, 'bank_heist', { now: NOW + 2 * HOUR }).ok, true, 'released');

  const cooling = { ...getCriminal(guildId, 'bob'), cooldowns: { rob_store: NOW } };
  const cool = canAttempt(guildId, cooling, 'rob_store', { now: NOW + HOUR });
  assert.equal(cool.reason, 'cooldown');
  assert.equal(cool.remainingMs, 5 * HOUR);
  assert.equal(canAttempt(guildId, cooling, 'bank_heist', { now: NOW + HOUR }).ok, true, 'other crimes are free');
  assert.equal(cooldownFor(cooling, 'rob_store', NOW + 7 * HOUR), 0);
});

test('targeted crimes need a real, solvent mark', () => {
  const guildId = freshGuildId();
  const criminal = getCriminal(guildId, 'alice');
  assert.equal(canAttempt(guildId, criminal, 'pickpocket', { now: NOW }).reason, 'target-required');
  assert.equal(
    canAttempt(guildId, criminal, 'pickpocket', { now: NOW, target: { self: true }, targetBalance: 9999 }).reason,
    'target-self',
  );
  assert.equal(
    canAttempt(guildId, criminal, 'pickpocket', { now: NOW, target: { bot: true }, targetBalance: 9999 }).reason,
    'target-bot',
  );
  // The cog refuses a mark holding less than max(minStealBalance, minReward).
  const poor = canAttempt(guildId, criminal, 'pickpocket', { now: NOW, target: {}, targetBalance: 120 });
  assert.equal(poor.reason, 'target-too-poor');
  assert.equal(poor.minimum, 150, 'pickpocket min_reward beats the 100 floor');
  assert.equal(canAttempt(guildId, criminal, 'pickpocket', { now: NOW, target: {}, targetBalance: 150 }).ok, true);
  assert.equal(canAttempt(guildId, criminal, 'nonsense', { now: NOW }).reason, 'unknown-crime');
});

// ── committing ───────────────────────────────────────────────────────────────

test('a successful store job pays out, stamps the cooldown and grows the streak', async () => {
  const guildId = freshGuildId();
  const before = balanceOf(guildId, 'alice');
  const outcome = await commitCrime(guildId, 'alice', 'rob_store', {
    now: NOW,
    rng: noEvents(0.1, { ints: [1500] }),
  });
  assert.equal(outcome.success, true);
  // No events drawn... except the guaranteed first one, whose multiplier may
  // apply; the payout is what the service actually paid.
  assert.equal(balanceOf(guildId, 'alice'), before + outcome.payout);

  const criminal = getCriminal(guildId, 'alice');
  assert.equal(criminal.cooldowns.rob_store, NOW);
  assert.equal(criminal.lastCrimeAt, NOW);
  assert.equal(criminal.streak, 1);
  assert.equal(criminal.stats.successes, 1);
  assert.equal(criminal.stats.earned, outcome.payout);
  assert.equal(criminal.stats.largestHeist, outcome.payout);
  assert.equal(criminal.jailMs, 0, 'nobody goes inside on a win');
});

test('a failed bank job fines the crook and starts the sentence', async () => {
  const guildId = freshGuildId();
  adjustBalance(guildId, 'bob', 50_000);
  const before = balanceOf(guildId, 'bob');
  const outcome = await commitCrime(guildId, 'bob', 'bank_heist', { now: NOW, rng: noEvents(0.99) });
  assert.equal(outcome.success, false);
  assert.equal(outcome.fine, 2000, 'int(5000 × 0.4)');
  assert.equal(balanceOf(guildId, 'bob'), before - 2000 + outcome.creditChange);

  const criminal = getCriminal(guildId, 'bob');
  assert.equal(criminal.stats.failures, 1);
  assert.equal(criminal.stats.finesPaid, 2000);
  assert.equal(criminal.streak, 0);
  assert.equal(criminal.jailStartedAt, NOW);
  assert.ok(criminal.jailMs > 0);
  assert.equal(jailState(criminal, NOW).jailed, true);
  assert.equal(jailState(criminal, NOW + 24 * HOUR).jailed, false, 'time served');
});

test('a mugging moves money between members and records both sides', async () => {
  const guildId = freshGuildId();
  adjustBalance(guildId, 'victim', 40_000);
  const victimBefore = balanceOf(guildId, 'victim');
  const crookBefore = balanceOf(guildId, 'crook');

  const outcome = await commitCrime(guildId, 'crook', 'mugging', {
    targetId: 'victim',
    now: NOW,
    rng: noEvents(0.1, { uniforms: [0.2] }),
  });
  assert.equal(outcome.success, true);
  assert.ok(outcome.takenFromTarget > 0);
  assert.equal(balanceOf(guildId, 'victim'), victimBefore - outcome.takenFromTarget);
  assert.equal(balanceOf(guildId, 'crook'), crookBefore + outcome.netForCrook);
  assert.equal(getCriminal(guildId, 'crook').stats.stolenFrom, outcome.takenFromTarget);
  assert.equal(getCriminal(guildId, 'victim').stats.stolenBy, outcome.takenFromTarget, 'the victim keeps a record too');
});

test('a steal never takes more than the victim actually holds (defensive clamp)', async () => {
  // In normal play this cannot trigger: a steal is a PERCENTAGE of the
  // victim's own balance, so the intended transfer is always well under it.
  // The clamp exists for the gap between reading a balance and moving it, so
  // force an oversized draw (a percentage above the crime's real range) to
  // prove the guard holds and nobody ever goes negative.
  const guildId = freshGuildId();
  adjustBalance(guildId, 'skint', -balanceOf(guildId, 'skint'));
  adjustBalance(guildId, 'skint', 200);
  const outcome = await commitCrime(guildId, 'crook', 'pickpocket', {
    targetId: 'skint',
    now: NOW,
    rng: noEvents(0.1, { uniforms: [3.0] }),
  });
  assert.equal(outcome.success, true);
  assert.equal(outcome.stolenFromTarget > 200, true, 'the resolver wanted more than they had');
  assert.equal(outcome.takenFromTarget, 200, 'clamped to the balance');
  assert.equal(balanceOf(guildId, 'skint'), 0, 'cleaned out, never negative');
  assert.ok(outcome.shortfall > 0, 'the rest simply was not there');
  assert.equal(outcome.payout, outcome.stolenFromTarget - outcome.shortfall, 'the crook is paid what actually moved');
});

test('the leaderboard sorts by what was earned', async () => {
  const guildId = freshGuildId();
  updateCriminal(guildId, 'small', (c) => ({ ...c, stats: { ...c.stats, earned: 100 } }));
  updateCriminal(guildId, 'big', (c) => ({ ...c, stats: { ...c.stats, earned: 9000 } }));
  updateCriminal(guildId, 'middle', (c) => ({ ...c, stats: { ...c.stats, earned: 500 } }));
  assert.deepEqual(topCriminals(guildId).map((entry) => entry.id), ['big', 'middle', 'small']);
});

// ── rendering + group wiring ─────────────────────────────────────────────────

test('the result card shows the events, the maths and the sentence', () => {
  const win = crimeEmbed(
    {
      crimeType: 'bank_heist',
      success: true,
      events: [{ text: 'You found a dropped wallet! 💰 (+{credits_bonus} {currency})', credits_bonus: 100 }],
      successChance: 0.42,
      payout: 3933,
      takenFromTarget: 0,
      shortfall: 0,
      creditChange: 100,
      steps: [
        { label: 'Base amount', amount: 3333 },
        { label: 'Streak ×3', amount: 3833, multiplier: 1.15 },
      ],
      streak: { streak: 3, multiplier: 1.15 },
    },
    'Alice',
  ).toJSON();
  assert.match(win.title, /Bank Heist — ✅ Clean getaway/);
  assert.match(win.description, /dropped wallet! 💰 \(\+100 🍩\)/, 'placeholders are filled in');
  assert.match(win.description, /got away with \*\*3,933 🍩\*\*/);
  assert.match(win.description, /Streak ×3 → 3,833/);
  assert.match(win.footer.text, /42% odds/);

  const bust = crimeEmbed(
    {
      crimeType: 'rob_store',
      success: false,
      events: [],
      successChance: 0.5,
      fine: 800,
      finePaid: 300,
      brokeAndDoubled: true,
      jailMs: 6 * HOUR,
      creditChange: 0,
      payout: 0,
      streak: { streak: 0, multiplier: 1 },
    },
    'Bob',
  ).toJSON();
  assert.match(bust.title, /🚨 Caught/);
  assert.match(bust.description, /could not cover the \*\*800 🍩\*\* fine/);
  assert.match(bust.description, /took the \*\*300 🍩\*\* you had and doubled/);
  assert.match(bust.description, /streak is back to zero/);
});

test('!crime group shape: five public subcommands, city alias', () => {
  const group = crimeCommand.group;
  assert.equal(group.name, 'crime');
  assert.ok(group.aliases.includes('city'));
  assert.equal(group.permission, undefined, 'the underworld is public');
  assert.deepEqual(
    group.subcommands.map((s) => s.name),
    ['pickpocket', 'mug', 'store', 'bank', 'stats'],
  );
  assert.ok(group.subcommands.every((s) => s.permission === undefined));
  // The two person-crimes take a member; the rest take nothing.
  assert.deepEqual(
    group.subcommands.map((s) => s.args.length),
    [1, 1, 0, 0, 1],
  );
  assert.equal(CRIMES.pickpocket.requiresTarget, true);
  assert.equal(CRIMES.rob_store.requiresTarget, false);
});
