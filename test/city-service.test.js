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

test('!crime group shape: the full surface, admin gated', () => {
  const group = crimeCommand.group;
  assert.equal(group.name, 'crime');
  assert.ok(group.aliases.includes('city'));
  assert.equal(group.permission, undefined, 'the underworld is public');
  assert.deepEqual(
    group.subcommands.map((s) => s.name),
    [
      'pickpocket',
      'mug',
      'store',
      'bank',
      'random',
      'bail',
      'jailbreak',
      'market',
      'buy',
      'usepass',
      'leaderboard',
      'admin',
      'stats',
    ],
  );
  const gated = group.subcommands.filter((s) => s.permission !== undefined).map((s) => s.name);
  assert.deepEqual(gated, ['admin'], 'only the tuning surface is gated');
  assert.equal(CRIMES.pickpocket.requiresTarget, true);
  assert.equal(CRIMES.rob_store.requiresTarget, false);
});

// ── slice C: bail, jailbreak, scenarios ──────────────────────────────────────

test('the 46 scenarios and 14 prison breaks came out of the source intact', async () => {
  const { prisonBreaks, randomScenarios, scenarioToCrime } = await import('../src/modules/city/lib/scenarios.js');
  const scenarios = randomScenarios();
  assert.equal(scenarios.length, 46);
  for (const scenario of scenarios) {
    for (const key of ['name', 'risk', 'min_reward', 'max_reward', 'success_rate', 'jail_time', 'fine_multiplier', 'attempt_text', 'success_text', 'fail_text']) {
      assert.ok(key in scenario, `${scenario.name} has ${key}`);
    }
    assert.ok(['low', 'medium', 'high'].includes(scenario.risk), 'the risk constants resolved during the dump');
    assert.ok(scenario.min_reward <= scenario.max_reward);
    assert.ok(scenario.success_rate > 0 && scenario.success_rate <= 1);
  }
  const breaks = prisonBreaks();
  assert.equal(breaks.length, 14);
  for (const script of breaks) {
    assert.ok(script.name && script.attempt_text && script.success_text && script.fail_text);
    assert.ok(script.base_chance > 0 && script.base_chance <= 1);
    for (const event of script.events ?? []) assert.ok(event.text, 'every break event has text');
  }

  // A scenario overrides the numbers but keeps the `random` crime's cooldown.
  const crime = scenarioToCrime(scenarios[0]);
  assert.equal(crime.maxReward, scenarios[0].max_reward);
  assert.equal(crime.jailMs, scenarios[0].jail_time * 1000);
  assert.equal(crime.cooldownMs, CRIMES.random.cooldownMs);
  assert.equal(crime.requiresTarget, false);
});

test('a scenario crime runs the normal pipeline with the scenario numbers', async () => {
  const { commitScenarioCrime } = await import('../src/modules/city/service.js');
  const { randomScenarios } = await import('../src/modules/city/lib/scenarios.js');
  const guildId = freshGuildId();
  const before = balanceOf(guildId, 'alice');
  const scenario = randomScenarios()[0];
  const outcome = await commitScenarioCrime(guildId, 'alice', {
    now: NOW,
    // The scenario crime has NO event pool, so drawEvents makes no rng calls
    // at all: pick the scenario, roll for success, draw the reward.
    rng: scriptRng({ picks: [0], floats: [0.01], ints: [scenario.min_reward] }),
  });
  assert.equal(outcome.scenario.name, scenario.name);
  assert.equal(outcome.success, true);
  assert.equal(balanceOf(guildId, 'alice'), before + outcome.payout);
  assert.equal(getCriminal(guildId, 'alice').cooldowns.random, NOW, 'the scenario crime has its own cooldown');
});

test('bail costs what is left of the sentence and clears the cell', async () => {
  const { payCityBail, setCitySettings: setSettings } = await import('../src/modules/city/service.js');
  const guildId = freshGuildId();
  assert.equal((await payCityBail(guildId, 'free', { now: NOW })).error, 'not-jailed');

  updateCriminal(guildId, 'jailed', (c) => ({ ...c, jailMs: HOUR, jailStartedAt: NOW }));
  adjustBalance(guildId, 'jailed', -balanceOf(guildId, 'jailed'));
  adjustBalance(guildId, 'jailed', 20); // under the 48 that bail will cost
  const poor = await payCityBail(guildId, 'jailed', { now: NOW + 30 * MINUTE });
  assert.equal(poor.error, 'too-poor');
  assert.equal(poor.cost, 48, 'int(1.6 × 30 minutes left)');

  adjustBalance(guildId, 'jailed', 1000);
  const paid = await payCityBail(guildId, 'jailed', { now: NOW + 30 * MINUTE });
  assert.equal(paid.ok, true);
  assert.equal(paid.cost, 48);
  const freed = getCriminal(guildId, 'jailed');
  assert.equal(jailState(freed, NOW + 31 * MINUTE).jailed, false, 'out');
  assert.equal(freed.stats.bailPaid, 48);

  setSettings(guildId, { allowBail: false });
  updateCriminal(guildId, 'jailed', (c) => ({ ...c, jailMs: HOUR, jailStartedAt: NOW }));
  assert.equal((await payCityBail(guildId, 'jailed', { now: NOW })).error, 'bail-disabled');
});

test('a jailbreak is one shot: out clean, or 30% added to what was left', async () => {
  const { attemptJailbreak } = await import('../src/modules/city/service.js');
  const guildId = freshGuildId();
  assert.equal((await attemptJailbreak(guildId, 'free', { now: NOW })).error, 'not-jailed');

  // A clean break: pick the first script, then a roll under its chance.
  updateCriminal(guildId, 'lucky', (c) => ({ ...c, jailMs: HOUR, jailStartedAt: NOW }));
  const out = await attemptJailbreak(guildId, 'lucky', {
    now: NOW + 10 * MINUTE,
    rng: scriptRng({ picks: [0], floats: [0.001] }),
  });
  assert.equal(out.success, true);
  assert.equal(jailState(getCriminal(guildId, 'lucky'), NOW + 11 * MINUTE).jailed, false);
  assert.equal(getCriminal(guildId, 'lucky').attemptedJailbreak, true, 'the attempt is spent');

  // A failure stretches the REMAINING time by 30%.
  updateCriminal(guildId, 'unlucky', (c) => ({ ...c, jailMs: HOUR, jailStartedAt: NOW }));
  const caught = await attemptJailbreak(guildId, 'unlucky', {
    now: NOW + 20 * MINUTE,
    rng: scriptRng({ picks: [0], floats: [0.999] }),
  });
  assert.equal(caught.success, false);
  assert.equal(caught.addedMs, 12 * MINUTE, '30% of the 40 minutes left');
  assert.equal(caught.remainingMs, 52 * MINUTE);
  assert.equal(jailState(getCriminal(guildId, 'unlucky'), NOW + 20 * MINUTE).remainingMs, 52 * MINUTE);

  // And only one attempt per sentence.
  const again = await attemptJailbreak(guildId, 'unlucky', { now: NOW + 21 * MINUTE });
  assert.equal(again.error, 'already-tried');
});

test('a jailbreak scenario folds its events into the odds and the wallet', async () => {
  const { resolveJailbreak } = await import('../src/modules/city/lib/scenarios.js');
  const scenario = {
    base_chance: 0.35,
    events: [
      { text: 'a', chance_bonus: 0.2 },
      { text: 'b', chance_penalty: 0.05, currency_penalty: 100 },
      { text: 'c', currency_bonus: 250 },
    ],
  };
  const result = resolveJailbreak(scenario, scriptRng({ floats: [0.49] }));
  assert.ok(Math.abs(result.chance - 0.5) < 1e-9, '0.35 + 0.20 − 0.05');
  assert.equal(result.success, true, '0.49 < 0.50');
  assert.equal(result.currencyChange, 150, '+250 −100');
  // Every event applies — unlike a crime, there is no probability draw here.
  assert.equal(result.events.length, 3);
});

// ── slice D: the black market, leaderboards, admin ───────────────────────────

test('the market sells two working items — and not the one that would do nothing', async () => {
  const { MARKET_ITEMS } = await import('../src/modules/city/lib/market.js');
  const { marketCatalogue } = await import('../src/modules/city/service.js');
  assert.deepEqual(Object.keys(MARKET_ITEMS), ['jail_reducer', 'jail_pass']);
  assert.equal(MARKET_ITEMS.jail_reducer.cost, 20_000);
  assert.equal(MARKET_ITEMS.jail_pass.cost, 1000);
  assert.equal(marketCatalogue().length, 2);
  // The cog's third item (notify_ping) is deliberately absent: our jail has no
  // release timer, so it would take 10,000 donuts for nothing.
  assert.equal(MARKET_ITEMS.notify_ping, undefined);
});

test('buying: a perk is permanent and unique, a card stacks', async () => {
  const { buyMarketItem } = await import('../src/modules/city/service.js');
  const guildId = freshGuildId();
  adjustBalance(guildId, 'buyer', 100_000);
  const before = balanceOf(guildId, 'buyer');

  const perk = await buyMarketItem(guildId, 'buyer', 'jail_reducer', { now: NOW });
  assert.equal(perk.ok, true);
  assert.equal(balanceOf(guildId, 'buyer'), before - 20_000);
  assert.deepEqual(getCriminal(guildId, 'buyer').perks, ['jail_reducer']);
  assert.equal((await buyMarketItem(guildId, 'buyer', 'jail_reducer', { now: NOW })).error, 'already-owned');

  await buyMarketItem(guildId, 'buyer', 'jail_pass', { now: NOW });
  await buyMarketItem(guildId, 'buyer', 'jail_pass', { now: NOW });
  assert.equal(getCriminal(guildId, 'buyer').items.jail_pass, 2, 'consumables stack');
  assert.equal((await buyMarketItem(guildId, 'buyer', 'nonsense', { now: NOW })).error, 'unknown-item');

  adjustBalance(guildId, 'skint2', -balanceOf(guildId, 'skint2'));
  const poor = await buyMarketItem(guildId, 'skint2', 'jail_reducer', { now: NOW });
  assert.equal(poor.error, 'too-poor');
  assert.equal(poor.cost, 20_000);
});

test('the sentence-reduction perk shortens a sentence as it is handed down', async () => {
  const { applySentenceReduction } = await import('../src/modules/city/lib/market.js');
  assert.equal(applySentenceReduction(HOUR, []), HOUR, 'no perk, full time');
  assert.equal(applySentenceReduction(HOUR, ['jail_reducer']), 48 * MINUTE, 'int(60 × 0.8)');

  // End to end: the same failed job, with and without the perk.
  const plain = freshGuildId();
  adjustBalance(plain, 'crook', 50_000);
  await commitCrime(plain, 'crook', 'rob_store', { now: NOW, rng: noEvents(0.99) });
  const fullTime = getCriminal(plain, 'crook').jailMs;

  const perked = freshGuildId();
  adjustBalance(perked, 'crook', 50_000);
  updateCriminal(perked, 'crook', (c) => ({ ...c, perks: ['jail_reducer'] }));
  await commitCrime(perked, 'crook', 'rob_store', { now: NOW, rng: noEvents(0.99) });
  const shortened = getCriminal(perked, 'crook').jailMs;
  assert.equal(shortened, Math.trunc(fullTime * 0.8), 'the perk took 20% off');
});

test('a jail card walks you out once, and only while you are inside', async () => {
  const { useJailPass } = await import('../src/modules/city/service.js');
  const guildId = freshGuildId();
  assert.equal(useJailPass(guildId, 'nobody', { now: NOW }).error, 'no-pass');

  updateCriminal(guildId, 'holder', (c) => ({ ...c, items: { jail_pass: 2 } }));
  assert.equal(useJailPass(guildId, 'holder', { now: NOW }).error, 'not-jailed', 'saved for when it matters');
  assert.equal(getCriminal(guildId, 'holder').items.jail_pass, 2, 'nothing burned');

  updateCriminal(guildId, 'holder', (c) => ({ ...c, jailMs: HOUR, jailStartedAt: NOW, attemptedJailbreak: true }));
  const used = useJailPass(guildId, 'holder', { now: NOW + 10 * MINUTE });
  assert.equal(used.ok, true);
  assert.equal(used.left, 1);
  const freed = getCriminal(guildId, 'holder');
  assert.equal(jailState(freed, NOW + 11 * MINUTE).jailed, false);
  assert.equal(freed.items.jail_pass, 1);
  assert.equal(freed.attemptedJailbreak, false, 'a new sentence gets a fresh escape attempt');
});

test('six leaderboards, each sorted on its own stat', async () => {
  const { LEADERBOARD_CATEGORIES, cityLeaderboard } = await import('../src/modules/city/service.js');
  assert.deepEqual(Object.keys(LEADERBOARD_CATEGORIES), ['earned', 'biggest', 'jobs', 'stolen', 'fines', 'streak']);
  const guildId = freshGuildId();
  updateCriminal(guildId, 'earner', (c) => ({ ...c, stats: { ...c.stats, earned: 9000, successes: 2 } }));
  updateCriminal(guildId, 'grinder', (c) => ({ ...c, stats: { ...c.stats, earned: 100, successes: 40 } }));
  updateCriminal(guildId, 'streaker', (c) => ({ ...c, highest: 12 }));

  assert.deepEqual(cityLeaderboard(guildId, 'earned').map((r) => r.id), ['earner', 'grinder']);
  assert.deepEqual(cityLeaderboard(guildId, 'jobs').map((r) => r.id), ['grinder', 'earner']);
  assert.deepEqual(cityLeaderboard(guildId, 'streak'), [{ id: 'streaker', value: 12 }]);
  assert.deepEqual(cityLeaderboard(guildId, 'fines'), [], 'nobody has paid a fine here');
  assert.equal(cityLeaderboard(guildId, 'nonsense'), null);
});

test('the admin knobs write through to the live settings', () => {
  const guildId = freshGuildId();
  setCitySettings(guildId, { allowBail: false, maxStealAmount: 5000 });
  const settings = getCitySettings(guildId);
  assert.equal(settings.allowBail, false);
  assert.equal(settings.maxStealAmount, 5000);
  assert.equal(settings.bailCostMultiplier, 1.6, 'untouched knobs keep the cog default');
});
