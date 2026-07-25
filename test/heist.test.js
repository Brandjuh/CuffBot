// Heist slice A (S85 = M16.12, maxcogs port): the data tables' internal
// consistency (the numbers themselves were machine-diffed against the Python
// source at transcription time — see the manual), the XP curve, the pure
// resolver driven by a SCRIPTED rng so every branch and the cog's exact RNG
// call ORDER are pinned, and crafting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEISTS, ITEMS, MATERIAL_ITEMS, RECIPES, fmt } from '../src/modules/heist/lib/tables.js';
import {
  MAX_LEVEL,
  XP_TABLE,
  applyXp,
  getLevel,
  levelSuccessBonus,
  xpBar,
  xpForLevelStep,
  xpForNextLevel,
  xpGain,
  xpProgress,
} from '../src/modules/heist/lib/leveling.js';
import { bailTotal, decayedHeat, resolveHeist } from '../src/modules/heist/lib/resolve.js';
import { craftPlan, craftableFrom, sellRange } from '../src/modules/heist/lib/crafting.js';

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;

/**
 * An rng whose every value is scripted. Exhausting a queue throws, so a test
 * that passes also proves the resolver made exactly the calls the cog makes,
 * in the cog's order: int(success) → float(success) → int(reward|loss) →
 * float(material) [→ pick+int] → float(police) [→ uniform, pick].
 */
function scriptRng({ ints = [], floats = [], uniforms = [], picks = [] } = {}) {
  const take = (queue, what) => {
    if (queue.length === 0) throw new Error(`rng.${what} called more times than scripted`);
    return queue.shift();
  };
  return {
    ints: [...ints],
    floats: [...floats],
    int: function (min, max) {
      const value = take(this.ints, 'int');
      assert.ok(value >= min && value <= max, `scripted int ${value} outside [${min}, ${max}]`);
      return value;
    },
    float: function () {
      return take(this.floats, 'float');
    },
    uniform: function (a, b) {
      const value = take(uniforms, 'uniform');
      assert.ok(value >= a && value <= b, `scripted uniform ${value} outside [${a}, ${b}]`);
      return value;
    },
    pick: function (list) {
      const value = take(picks, 'pick');
      assert.ok(list.includes(value), `scripted pick ${value} not in ${list}`);
      return value;
    },
  };
}

const player = (over = {}) => ({
  inventory: {},
  equipped: { shield: null, tool: null },
  heat: 0,
  materialHeat: 0,
  debt: 0,
  xp: 0,
  stats: { success: 0, fail: 0, caught: 0 },
  ...over,
});

// A float high enough that no drop/arrest fires (both chances cap at 0.9).
const NO_ROLL = 0.95;

// ── the tables ───────────────────────────────────────────────────────────────

test('the tables still match the cog source, entry for entry', () => {
  // test/fixtures/heist-source-tables.json was produced by EXECUTING the cog's
  // utils.py and dumping ITEMS/RECIPES/HEISTS (timedeltas → ms, snake_case →
  // camelCase). It is the source of truth for the transcription, so this test
  // keeps every later slice honest long after the Python is gone.
  const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'heist-source-tables.json');
  const source = JSON.parse(readFileSync(fixturePath, 'utf8'));
  // Key ORDER carries no meaning in either language — compare canonically.
  const canonical = (value) => {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (value && typeof value === 'object') {
      return `{${Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, inner]) => `${JSON.stringify(key)}:${canonical(inner)}`)
        .join(',')}}`;
    }
    return JSON.stringify(value);
  };
  for (const [table, mine] of [['ITEMS', ITEMS], ['RECIPES', RECIPES], ['HEISTS', HEISTS]]) {
    assert.deepEqual(Object.keys(mine).sort(), Object.keys(source[table]).sort(), `${table} keys`);
    for (const key of Object.keys(source[table])) {
      assert.equal(canonical(mine[key]), canonical(source[table][key]), `${table}.${key} differs from the cog`);
    }
  }
});

test('the tables carry the cog inventory: 74 items, 28 recipes, 24 heists', () => {
  assert.equal(Object.keys(ITEMS).length, 74);
  assert.equal(Object.keys(RECIPES).length, 28);
  assert.equal(Object.keys(HEISTS).length, 24, 'the S65 survey said 25 — the cog has 24');
  assert.deepEqual(MATERIAL_ITEMS, [
    'scrap_metal',
    'tech_parts',
    'rare_alloy',
    'classified_docs',
    'military_grade_alloy',
  ]);
  assert.equal(fmt('hospital_pharmacy'), 'Hospital Pharmacy');
});

test('every table relationship holds: tools point at real jobs, recipes at real materials', () => {
  for (const [id, item] of Object.entries(ITEMS)) {
    assert.ok(['shield', 'tool', 'loot', 'material'].includes(item.type), `${id} type`);
    assert.ok(item.emoji, `${id} has an emoji`);
    if (item.type === 'tool') {
      assert.ok(HEISTS[item.forHeist], `${id} boosts a real heist (${item.forHeist})`);
      assert.ok(item.boost > 0 && item.boost <= 0.26, `${id} boost in range`);
    }
    if (item.type === 'shield') assert.ok(item.reduction > 0 && item.durationHours > 0, `${id} shield`);
    if (item.type === 'loot' || item.type === 'material') {
      assert.ok(item.minSell <= item.maxSell, `${id} sell range`);
    }
    // Crafted gear is not purchasable; everything else in the shop has a price.
    const crafted = Object.values(RECIPES).some((r) => r.result === id);
    if (crafted) assert.equal(item.cost, undefined, `${id} is crafted, so it has no shop price`);
  }
  for (const [name, recipe] of Object.entries(RECIPES)) {
    assert.ok(ITEMS[recipe.result], `${name} makes a real item`);
    assert.equal(recipe.result, name, 'recipes are keyed by their result');
    for (const material of Object.keys(recipe.materials)) {
      assert.ok(MATERIAL_ITEMS.includes(material), `${name} needs a real material (${material})`);
    }
  }
  for (const [name, heist] of Object.entries(HEISTS)) {
    assert.ok(heist.minSuccess <= heist.maxSuccess, `${name} success range`);
    assert.ok(heist.minReward <= heist.maxReward, `${name} reward range`);
    assert.ok(heist.minLoss <= heist.maxLoss, `${name} loss range`);
    assert.ok(heist.cooldownMs > 0 && heist.durationMs > 0 && heist.jailMs > 0, `${name} timings`);
    for (const tier of heist.materialTiers ?? []) {
      assert.ok(MATERIAL_ITEMS.includes(tier), `${name} tier ${tier}`);
    }
  }
  // Exactly three jobs are named after a loot item, so they pay in goods.
  assert.deepEqual(
    Object.keys(HEISTS).filter((name) => ITEMS[name]?.type === 'loot'),
    ['street_bike', 'street_motorcycle', 'street_car'],
  );
  assert.equal(HEISTS.crew_robbery.crewSize, 4);
});

// ── the XP curve ─────────────────────────────────────────────────────────────

test('the XP table is the cog curve — its own comment lies about level 2', () => {
  assert.equal(XP_TABLE[0], 0, 'level 1 starts at 0');
  assert.equal(xpForLevelStep(1), 112);
  assert.equal(XP_TABLE[1], 112, 'the cog comment claims 212; its formula says 112');
  assert.equal(XP_TABLE.length, MAX_LEVEL + 1);
  assert.equal(getLevel(0), 1);
  assert.equal(getLevel(111), 1);
  assert.equal(getLevel(112), 2, 'exactly on the threshold levels you up');
  assert.equal(getLevel(XP_TABLE[MAX_LEVEL - 1]), MAX_LEVEL);
  assert.equal(getLevel(XP_TABLE[MAX_LEVEL - 1] * 2), MAX_LEVEL, 'capped');
  assert.equal(xpForNextLevel(0), 112);
  assert.equal(xpForNextLevel(XP_TABLE[MAX_LEVEL - 1]), 0, 'nothing left at max');

  const progress = xpProgress(200);
  assert.equal(progress.level, 2);
  assert.equal(progress.into, 88);
  assert.equal(progress.span, XP_TABLE[2] - XP_TABLE[1]);
  assert.ok(progress.pct > 0 && progress.pct < 1);
  assert.deepEqual(xpProgress(XP_TABLE[MAX_LEVEL - 1]), { level: MAX_LEVEL, into: 0, span: 0, pct: 1.0 });
});

test('level bonus caps at +20% (level 40); XP gain follows the outcome', () => {
  assert.equal(levelSuccessBonus(1), 0.005);
  assert.equal(levelSuccessBonus(40), 0.20);
  assert.equal(levelSuccessBonus(120), 0.20, 'capped, not 60%');
  assert.equal(xpGain('bank', true, false), 160);
  assert.equal(xpGain('bank', false, false), 32, '20% of base on a failure');
  assert.equal(xpGain('parking_meter', false, false), 1, 'floor of 1 (int(8·0.2)=1)');
  assert.equal(xpGain('vending_machine', false, false), 1, 'max(1, int(9·0.2)=1)');
  assert.equal(xpGain('bank', true, true), 0, 'caught pays nothing');
  const applied = applyXp(100, 50);
  assert.deepEqual(applied, { oldLevel: 1, newLevel: 2, newXp: 150 });
  const maxed = applyXp(XP_TABLE[MAX_LEVEL - 1], 500);
  assert.equal(maxed.newXp, XP_TABLE[MAX_LEVEL - 1], 'XP stops at the max-level threshold');
  assert.ok(xpBar(0.5).startsWith('`●●●●●●●●●●○○○○○○○○○○`'));
  assert.ok(xpBar(0.5).endsWith('50.0%'));
});

// ── the resolver ─────────────────────────────────────────────────────────────

test('a clean success pays the drawn reward, with the event multiplier applied', () => {
  const rng = scriptRng({ ints: [55, 2500], floats: [0.4, NO_ROLL, NO_ROLL] });
  const out = resolveHeist(
    { heistType: 'atm_smash', heist: HEISTS.atm_smash, player: player(), balance: 10_000, eventMultiplier: 2, now: NOW },
    rng,
  );
  assert.equal(out.success, true);
  assert.equal(out.caught, false);
  assert.equal(out.baseSuccess, 55);
  assert.ok(Math.abs(out.successChance - 0.555) < 1e-9, 'drawn 55% plus the level-1 bonus of 0.5%');
  assert.equal(out.baseReward, 2500);
  assert.equal(out.reward, 5000, '2× event');
  assert.equal(out.balanceDelta, 5000);
  assert.equal(out.nextState.heat, 1, 'heat rises on every job');
  assert.equal(out.xpGained, 30);
  assert.deepEqual(out.nextState.stats, { success: 1, fail: 0, caught: 0 });
});

test('a loot-named job pays the item, not currency', () => {
  const rng = scriptRng({ ints: [30], floats: [0.1, NO_ROLL, NO_ROLL] });
  const out = resolveHeist(
    { heistType: 'street_car', heist: HEISTS.street_car, player: player(), balance: 0, now: NOW },
    rng,
  );
  assert.equal(out.success, true);
  assert.equal(out.lootItem, 'street_car');
  assert.equal(out.reward, 0);
  assert.equal(out.balanceDelta, 0);
  assert.equal(out.nextState.inventory.street_car, 1);
});

test('the equipped tool is consumed and its boost is added as whole percent points', () => {
  const rng = scriptRng({ ints: [40, 1000], floats: [0.4, NO_ROLL, NO_ROLL] });
  const out = resolveHeist(
    {
      heistType: 'atm_smash',
      heist: HEISTS.atm_smash,
      player: player({ inventory: { crowbar: 1 }, equipped: { shield: null, tool: 'crowbar' }, xp: 2000 }),
      balance: 0,
      now: NOW,
    },
    rng,
  );
  // level(2000) = 5 → bonus 0.025; crowbar boost 0.07 → int(7) percent points.
  assert.equal(out.toolUsed, 'crowbar');
  assert.equal(getLevel(2000), 5);
  assert.equal(out.toolBoost, 0.07);
  assert.ok(Math.abs(out.successChance - 0.495) < 1e-9, '(40 drawn + 7 tool)% + 2.5% level bonus');
  assert.equal(out.success, true, '0.4 < 0.495');
  assert.equal(out.nextState.inventory.crowbar, undefined, 'the last one is spent');
  assert.equal(out.nextState.equipped.tool, null, 'and unequipped');
});

test('a wrong-job tool is neither used nor consumed', () => {
  const rng = scriptRng({ ints: [50, 1000], floats: [0.9, NO_ROLL, NO_ROLL] });
  const out = resolveHeist(
    {
      heistType: 'atm_smash',
      heist: HEISTS.atm_smash,
      player: player({ inventory: { glass_cutter: 1 }, equipped: { shield: null, tool: 'glass_cutter' } }),
      balance: 100_000,
      now: NOW,
    },
    rng,
  );
  assert.equal(out.toolUsed, null);
  assert.equal(out.toolBoost, 0);
  assert.equal(out.nextState.inventory.glass_cutter, 1, 'still there');
  assert.equal(out.success, false);
});

test('a failure with a shield: the reduction applies and the shield is spent', () => {
  const rng = scriptRng({ ints: [50, 1000], floats: [0.9, NO_ROLL, NO_ROLL] });
  const out = resolveHeist(
    {
      heistType: 'atm_smash',
      heist: HEISTS.atm_smash,
      player: player({ inventory: { steel_shield: 2 }, equipped: { shield: 'steel_shield', tool: null } }),
      balance: 100_000,
      now: NOW,
    },
    rng,
  );
  assert.equal(out.success, false);
  assert.equal(out.shieldUsed, 'steel_shield');
  // 929, NOT the naive 930: 1 − 0.07 is 0.9299999999999999 in floating point,
  // so int(1000 × …) truncates to 929 — Python does exactly the same, and the
  // port preserves the expression rather than the intent (the S82 rule).
  assert.equal(out.loss, 929);
  assert.equal(out.lossPaid, 929);
  assert.equal(out.balanceDelta, -929);
  assert.equal(out.nextState.inventory.steel_shield, 1, 'one of the two is gone');
  assert.equal(out.nextState.equipped.shield, 'steel_shield', 'still equipped while stock remains');
  assert.equal(out.xpGained, 6, '20% of 30');
  assert.deepEqual(out.nextState.stats, { success: 0, fail: 1, caught: 0 });
});

test('the full shield absorbs everything — no loss, no debt', () => {
  const rng = scriptRng({ ints: [50, 1500], floats: [0.9, NO_ROLL, NO_ROLL] });
  const out = resolveHeist(
    {
      heistType: 'atm_smash',
      heist: HEISTS.atm_smash,
      player: player({ inventory: { full: 1 }, equipped: { shield: 'full', tool: null } }),
      balance: 0,
      now: NOW,
    },
    rng,
  );
  assert.equal(out.loss, 0);
  assert.equal(out.shieldAbsorbedAll, true);
  assert.equal(out.balanceDelta, 0);
  assert.equal(out.debtAdded, 0);
});

test('a loss you cannot pay becomes debt — with the 20% tax only when agreed', () => {
  const broke = () =>
    resolveHeist(
      {
        heistType: 'atm_smash',
        heist: HEISTS.atm_smash,
        player: player({ debt: 500 }),
        balance: 100,
        taxAgreed: true,
        now: NOW,
      },
      scriptRng({ ints: [50, 1000], floats: [0.9, NO_ROLL, NO_ROLL] }),
    );
  const taxed = broke();
  assert.equal(taxed.lossPaid, 0, 'nothing leaves an empty pocket');
  assert.equal(taxed.debtTax, 200);
  assert.equal(taxed.debtAdded, 1200);
  assert.equal(taxed.nextState.debt, 1700, 'added on top of the existing debt');

  const untaxed = resolveHeist(
    { heistType: 'atm_smash', heist: HEISTS.atm_smash, player: player(), balance: 100, taxAgreed: false, now: NOW },
    scriptRng({ ints: [50, 1000], floats: [0.9, NO_ROLL, NO_ROLL] }),
  );
  assert.equal(untaxed.debtTax, 0);
  assert.equal(untaxed.debtAdded, 1000);
});

test('caught after a paying success: the money is seized, jail and bail are set, no XP', () => {
  const rng = scriptRng({ ints: [50, 2000], floats: [0.1, NO_ROLL, 0.01], uniforms: [0.75] });
  const out = resolveHeist(
    { heistType: 'atm_smash', heist: HEISTS.atm_smash, player: player({ heat: 3 }), balance: 0, now: NOW },
    rng,
  );
  assert.equal(out.success, true);
  assert.equal(out.caught, true);
  assert.equal(out.reward, 2000);
  assert.equal(out.seized, 2000);
  assert.equal(out.balanceDelta, 0, 'paid then taken straight back');
  assert.equal(out.jail.endsAt, NOW + 2 * HOUR);
  assert.equal(out.jail.bail, 1125, 'int(max_loss 1500 × 0.75)');
  assert.equal(out.jail.bailTax, 168, 'int(1125 × 0.15)');
  assert.equal(out.jail.bailTotal, 1293);
  assert.equal(out.nextState.heat, 0, 'an arrest wipes the heat');
  assert.equal(out.xpGained, 0);
  assert.deepEqual(out.nextState.stats, { success: 0, fail: 0, caught: 1 });
});

test('caught after a failure: the police take a loot item from the collection', () => {
  const rng = scriptRng({
    ints: [50, 1000],
    floats: [0.9, NO_ROLL, 0.01],
    uniforms: [0.5],
    picks: ['jewelry'],
  });
  const out = resolveHeist(
    {
      heistType: 'atm_smash',
      heist: HEISTS.atm_smash,
      player: player({ inventory: { jewelry: 2, scrap_metal: 5 } }),
      balance: 100_000,
      now: NOW,
    },
    rng,
  );
  assert.equal(out.caught, true);
  assert.equal(out.confiscated, 'jewelry');
  assert.equal(out.nextState.inventory.jewelry, 1);
  assert.equal(out.nextState.inventory.scrap_metal, 5, 'materials are safe');
});

test('caught after a loot success: that very item is confiscated', () => {
  const rng = scriptRng({ ints: [50], floats: [0.1, NO_ROLL, 0.01], uniforms: [0.5] });
  const out = resolveHeist(
    { heistType: 'street_bike', heist: HEISTS.street_bike, player: player(), balance: 0, now: NOW },
    rng,
  );
  assert.equal(out.success, true);
  assert.equal(out.caught, true);
  assert.equal(out.confiscated, 'street_bike');
  assert.equal(out.nextState.inventory.street_bike, undefined, 'gained then taken');
});

test('material drops: the pool, the quantity, and the counter reset', () => {
  const dropped = resolveHeist(
    {
      heistType: 'pocket_steal',
      heist: HEISTS.pocket_steal,
      player: player({ materialHeat: 5 }),
      balance: 0,
      now: NOW,
    },
    scriptRng({ ints: [75, 200, 3], floats: [0.1, 0.43, NO_ROLL], picks: ['tech_parts'] }),
  );
  assert.deepEqual(dropped.materialDrop, { item: 'tech_parts', qty: 3 });
  assert.equal(dropped.nextState.inventory.tech_parts, 3);
  assert.equal(dropped.nextState.materialHeat, 0, 'the counter resets on a drop');

  const missed = resolveHeist(
    { heistType: 'pocket_steal', heist: HEISTS.pocket_steal, player: player({ materialHeat: 5 }), balance: 0, now: NOW },
    scriptRng({ ints: [75, 200], floats: [0.1, 0.45, NO_ROLL] }),
  );
  assert.equal(missed.materialDrop, null, '0.45 ≥ 0.44');
  assert.equal(missed.nextState.materialHeat, 6, 'the counter keeps climbing');

  // An end-game job restricts the pool to its own tiers.
  const tiered = resolveHeist(
    { heistType: 'space_agency', heist: HEISTS.space_agency, player: player(), balance: 0, now: NOW },
    scriptRng({ ints: [20, 150_000, 2], floats: [0.1, 0.1, NO_ROLL], picks: ['classified_docs'] }),
  );
  assert.equal(tiered.materialDrop.item, 'classified_docs');
});

test('heat drives the police chance and the 0.9 cap holds', () => {
  // pocket_steal police 0.05; heat 2 → +1 = 3 → 0.05 + 0.06 = 0.11.
  const escaped = resolveHeist(
    { heistType: 'pocket_steal', heist: HEISTS.pocket_steal, player: player({ heat: 2 }), balance: 0, now: NOW },
    scriptRng({ ints: [75, 100], floats: [0.1, NO_ROLL, 0.11] }),
  );
  assert.equal(escaped.caught, false, '0.11 is not < 0.11');
  assert.equal(escaped.nextState.heat, 3);

  const busted = resolveHeist(
    { heistType: 'pocket_steal', heist: HEISTS.pocket_steal, player: player({ heat: 2 }), balance: 0, now: NOW },
    scriptRng({ ints: [75, 100], floats: [0.1, NO_ROLL, 0.109], uniforms: [0.5] }),
  );
  assert.equal(busted.caught, true);

  // space_agency police 0.5 with heat 99 would be 2.48 → capped at 0.9.
  const capped = resolveHeist(
    { heistType: 'space_agency', heist: HEISTS.space_agency, player: player({ heat: 99 }), balance: 0, now: NOW },
    scriptRng({ ints: [20, 150_000], floats: [0.1, NO_ROLL, 0.91] }),
  );
  assert.equal(capped.caught, false, 'even at absurd heat, 0.9 is the ceiling');
});

test('heat decays one point per full two idle hours', () => {
  assert.equal(decayedHeat(0, NOW - 100 * HOUR, NOW), 0);
  assert.equal(decayedHeat(5, null, NOW), 5, 'never stamped = no decay');
  assert.equal(decayedHeat(5, NOW - 1 * HOUR, NOW), 5, 'under two hours: nothing');
  assert.equal(decayedHeat(5, NOW - 5 * HOUR, NOW), 3, 'two full decays');
  assert.equal(decayedHeat(5, NOW - 100 * HOUR, NOW), 0, 'never below zero');
  assert.equal(bailTotal(1000), 1150);
});

// ── crafting ─────────────────────────────────────────────────────────────────

test('crafting spends the exact materials and reports what is missing', () => {
  assert.deepEqual(craftPlan({}, 'nope'), { ok: false, error: 'unknown-recipe' });
  const short = craftPlan({ scrap_metal: 3 }, 'reinforced_wooden_shield');
  assert.deepEqual(short, { ok: false, error: 'missing', missing: { scrap_metal: 2 } });

  const made = craftPlan({ scrap_metal: 7, rare_alloy: 2, jewelry: 1 }, 'reinforced_iron_shield');
  assert.equal(made.ok, true);
  assert.equal(made.result, 'reinforced_iron_shield');
  assert.deepEqual(made.inventory, { jewelry: 1, reinforced_iron_shield: 1 }, 'materials fully spent');

  const partial = craftPlan({ scrap_metal: 10 }, 'reinforced_wooden_shield');
  assert.deepEqual(partial.inventory, { scrap_metal: 5, reinforced_wooden_shield: 1 });

  assert.deepEqual(craftableFrom({ tech_parts: 3 }), ['enhanced_pickpocket_gloves']);
  assert.deepEqual(craftableFrom({}), []);
  assert.deepEqual(sellRange('jewelry'), { min: 5000, max: 15000 });
  assert.equal(sellRange('crowbar'), null, 'tools are not sellable');
});
