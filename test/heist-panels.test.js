// M26.4a: the four player-facing heist panels.
//
// S115 measured the source at 31 `discord.ui` references against our 1 — eight
// panels, of which S88 built only the crew lobby. These pin the four a player
// actually touches. Pure only: plain objects in, a description out, so "a job
// on cooldown is not selectable" is assertable without a gateway.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EQUIP_SLOTS,
  HEISTS_PER_PAGE,
  PANEL_TIMEOUT_MS,
  RECIPES_PER_PAGE,
  SHOP_SECTIONS,
  canCraft,
  clampPage,
  cooldownLabel,
  craftPanel,
  equipPanel,
  itemEffect,
  jobPanel,
  navRow,
  pageCount,
  riskLabel,
  shopPanel,
} from '../src/modules/heist/lib/panels.js';
import { decodeId, encodeId } from '../src/modules/heist/panel-runtime.js';
import { HEISTS, ITEMS, RECIPES } from '../src/modules/heist/lib/tables.js';
import { MAX_LEVEL, levelSuccessBonus } from '../src/modules/heist/lib/leveling.js';

const free = () => 0;

// ── the shared furniture ─────────────────────────────────────────────────────

test('the page sizes and the timeout are the source’s', () => {
  assert.equal(HEISTS_PER_PAGE, 7);
  assert.equal(RECIPES_PER_PAGE, 10);
  assert.equal(PANEL_TIMEOUT_MS, 120_000);
});

test('pageCount never reports zero pages, even for an empty list', () => {
  assert.equal(pageCount(0, 7), 1, 'an empty board is still one page, not none');
  assert.equal(pageCount(7, 7), 1);
  assert.equal(pageCount(8, 7), 2);
  assert.equal(pageCount(24, 7), 4);
});

test('a page index is clamped, so a stale button cannot scroll off the end', () => {
  assert.equal(clampPage(-3, 24, 7), 0);
  assert.equal(clampPage(99, 24, 7), 3);
  assert.equal(clampPage(2, 24, 7), 2);
});

test('the nav row disables the edge it is already at', () => {
  const first = navRow('job', 0, 4);
  assert.equal(first[0].disabled, true, 'no previous page from the first');
  assert.equal(first[2].disabled, false);
  const last = navRow('job', 3, 4);
  assert.equal(last[0].disabled, false);
  assert.equal(last[2].disabled, true);
  assert.equal(navRow('job', 0, 1)[2].disabled, true, 'a single page has nowhere to go either way');
});

test('the page counter is a label, never a target', () => {
  const [, counter] = navRow('job', 1, 4);
  assert.equal(counter.label, '2/4');
  assert.equal(counter.disabled, true, 'a pressable counter would do nothing');
});

test('risk reads off the police chance, in the source’s four bands', () => {
  assert.match(riskLabel(0.05), /Low/);
  assert.match(riskLabel(0.1), /Medium/);
  assert.match(riskLabel(0.2), /High/);
  assert.match(riskLabel(0.35), /Extreme/);
  assert.match(riskLabel(undefined), /Low/, 'a missing chance is not a crash');
});

test('cooldowns read as cooldowns', () => {
  assert.equal(cooldownLabel(30 * 60_000), '30m');
  assert.equal(cooldownLabel(2 * 3_600_000), '2h');
  assert.equal(cooldownLabel(90 * 60_000), '1h 30m');
  assert.equal(cooldownLabel(24 * 3_600_000), '1d');
  assert.equal(cooldownLabel(30 * 3_600_000), '1d 6h');
});

// ── 1. the job board ─────────────────────────────────────────────────────────

test('the board pages through every job in the table', () => {
  const total = Object.keys(HEISTS).length;
  const first = jobPanel({ cooldownLeft: free });
  assert.equal(first.pages, pageCount(total, HEISTS_PER_PAGE));
  assert.equal(first.rows.length, HEISTS_PER_PAGE);

  const seen = new Set();
  for (let page = 0; page < first.pages; page += 1) {
    for (const row of jobPanel({ cooldownLeft: free, page }).rows) seen.add(row.type);
  }
  assert.equal(seen.size, total, 'every job is reachable by paging');
});

test('the success band shown INCLUDES the level bonus — the static list did not', () => {
  // This is the reason the panel beats `!heist jobs`: a level-40 player was
  // reading the table's raw numbers, which were not their odds.
  const [low] = jobPanel({ level: 1, cooldownLeft: free }).rows;
  const [high] = jobPanel({ level: 100, cooldownLeft: free }).rows;
  assert.notEqual(low.success, high.success);
  assert.match(jobPanel({ level: 100, cooldownLeft: free }).lines.join('\n'), /from level 100/);
});

test('the bonus is capped at 100% rather than printing 115%', () => {
  // ⚠️ The first version of this test read page 0 only, and PASSED against a
  // build with the cap removed — the job that overflows (maxSuccess 95, plus
  // 20 points at level 120) is not on the first page. A cap test that never
  // reaches the capping case tests nothing. Sweep every page, and assert the
  // overflow is real so the guard cannot become vacuous again if the table
  // changes.
  const bonus = Math.trunc(levelSuccessBonus(MAX_LEVEL) * 100);
  const highest = Math.max(...Object.values(HEISTS).map((h) => h.maxSuccess));
  assert.ok(highest + bonus > 100, 'the cap is unreachable — this guard would be vacuous');

  const pages = jobPanel({ cooldownLeft: free }).pages;
  let sawCapped = false;
  for (let page = 0; page < pages; page += 1) {
    for (const row of jobPanel({ level: MAX_LEVEL, cooldownLeft: free, page }).rows) {
      const [, max] = row.success.replace('%', '').split('–').map(Number);
      assert.ok(max <= 100, `${row.type} shows ${row.success}`);
      if (max === 100) sawCapped = true;
    }
  }
  assert.ok(sawCapped, 'at least one job must actually hit the cap');
});

test('a job on cooldown stays visible but unselectable, with its wait', () => {
  const target = Object.keys(HEISTS)[0];
  const panel = jobPanel({ cooldownLeft: (type) => (type === target ? 10 * 60_000 : 0) });
  const row = panel.rows.find((r) => r.type === target);
  assert.equal(row.selectable, false);
  assert.equal(row.unavailable, '⏳ 10m');
  assert.equal(panel.rows.filter((r) => r.selectable).length, panel.rows.length - 1);
  assert.equal(panel.select.disabled, false, 'the others can still be picked');
});

test('an all-cooldown page disables the picker instead of offering refusals', () => {
  const panel = jobPanel({ cooldownLeft: () => 60_000 });
  assert.equal(panel.select.disabled, true);
  assert.match(panel.select.placeholder, /cooling down/);
});

test('the reason a job is unavailable rides in its own option row', () => {
  const target = Object.keys(HEISTS)[0];
  const panel = jobPanel({ cooldownLeft: (type) => (type === target ? 60_000 : 0) });
  const option = panel.select.options.find((o) => o.value === target);
  assert.match(option.description, /⏳/);
});

// ── 2. the shop ──────────────────────────────────────────────────────────────

test('the shop has one page per section, and every section has stock', () => {
  assert.deepEqual(SHOP_SECTIONS.map((s) => s.key), ['shield', 'tool']);
  for (let page = 0; page < SHOP_SECTIONS.length; page += 1) {
    const panel = shopPanel({ balance: 1_000_000, page });
    assert.ok(panel.stock.length > 0, `${SHOP_SECTIONS[page].key} page is empty`);
    assert.equal(panel.pages, SHOP_SECTIONS.length);
  }
});

test('the shop shows the OVERRIDDEN price, not the table constant', () => {
  // Prices are owner-tunable (S88), so a shelf reading the constant would lie.
  const id = Object.entries(ITEMS).find(([, d]) => d.type === 'shield' && d.cost !== undefined)[0];
  const panel = shopPanel({ balance: 1_000_000, costs: { [id]: 99 } });
  assert.equal(panel.stock.find((i) => i.id === id).cost, 99);
  assert.match(panel.lines.join('\n'), /99 🍩/);
});

test('what you cannot afford is marked, and an empty wallet kills the menu', () => {
  const broke = shopPanel({ balance: 0 });
  assert.match(broke.lines.join('\n'), /too expensive/);
  assert.equal(broke.select.disabled, true, 'nothing to press means a dead menu, not a refusal');
  assert.match(broke.select.placeholder, /afford/);
  assert.equal(shopPanel({ balance: 1_000_000 }).select.disabled, false);
});

test('the wallet is on screen, because the price only means something against it', () => {
  assert.match(shopPanel({ balance: 4_321 }).lines.join('\n'), /4,321 🍩/);
});

test('every item type has an effect line — none can print "undefined"', () => {
  for (const [name, data] of Object.entries(ITEMS)) {
    const effect = itemEffect(data);
    assert.equal(typeof effect, 'string', name);
    assert.doesNotMatch(effect, /undefined|NaN/, `${name}: ${effect}`);
  }
});

test('no select option description exceeds Discord’s 100-character limit', () => {
  // A too-long description is rejected at send time, which would break the
  // panel on a live server and never in a unit test that only reads objects.
  const panels = [
    jobPanel({ cooldownLeft: free }),
    shopPanel({ balance: 5_000 }),
    craftPanel({ inventory: {} }),
    ...equipPanel({ inventory: { wooden_shield: 1 }, equipped: {} }).selects.map((s) => ({ select: s })),
  ];
  for (const panel of panels) {
    for (const option of panel.select?.options ?? []) {
      assert.ok(option.description.length <= 100, `${option.value}: ${option.description.length} chars`);
    }
  }
});

// ── 3. the equipment rack ────────────────────────────────────────────────────

test('there is one slot per equippable type our table actually has', () => {
  // The source has three slots; our S85 table has no `consumable` type at all,
  // so a third rack would be an empty select forever.
  assert.deepEqual(EQUIP_SLOTS, ['shield', 'tool']);
  const types = new Set(Object.values(ITEMS).map((i) => i.type));
  for (const slot of EQUIP_SLOTS) assert.ok(types.has(slot), `no ${slot} items exist`);
  assert.equal(types.has('consumable'), false, 'if this ever fails, add the third slot');
});

test('an empty locker offers nothing and says where to get gear', () => {
  const panel = equipPanel({ inventory: {}, equipped: {} });
  assert.equal(panel.selects.every((s) => s.disabled), true);
  assert.equal(panel.buttons.every((b) => b.disabled), true, 'nothing worn means nothing to take off');
  assert.match(panel.lines.join('\n'), /heist shop/);
});

test('only what you own appears, and what you wear is marked', () => {
  const panel = equipPanel({
    inventory: { wooden_shield: 2, iron_shield: 0 },
    equipped: { shield: 'wooden_shield' },
  });
  const shield = panel.slots.find((s) => s.slot === 'shield');
  assert.deepEqual(shield.owned.map((o) => o.id), ['wooden_shield'], 'a zero count is not owned');
  assert.equal(shield.worn.id, 'wooden_shield');
  assert.equal(panel.selects[0].options[0].default, true, 'the worn item is preselected');
});

test('Unequip is live only for a slot that has something in it', () => {
  const panel = equipPanel({ inventory: { wooden_shield: 1 }, equipped: { shield: 'wooden_shield' } });
  const byId = Object.fromEntries(panel.buttons.map((b) => [b.id, b]));
  assert.equal(byId['unequip:shield'].disabled, false);
  assert.equal(byId['unequip:tool'].disabled, true);
});

test('an item equipped but no longer owned does not crash the rack', () => {
  const panel = equipPanel({ inventory: {}, equipped: { shield: 'wooden_shield' } });
  assert.equal(panel.slots.find((s) => s.slot === 'shield').worn.id, 'wooden_shield');
  assert.equal(panel.slots.find((s) => s.slot === 'shield').owned.length, 0);
});

// ── 4. the crafting bench ────────────────────────────────────────────────────

const recipeName = Object.keys(RECIPES)[0];
const recipeMats = RECIPES[recipeName].materials;
const enough = Object.fromEntries(Object.entries(recipeMats).map(([m, q]) => [m, q]));
const short = Object.fromEntries(Object.entries(recipeMats).map(([m, q]) => [m, q - 1]));

test('canCraft is exactly "every material at or above its quantity"', () => {
  assert.equal(canCraft(enough, RECIPES[recipeName]), true);
  assert.equal(canCraft(short, RECIPES[recipeName]), false);
  assert.equal(canCraft({}, RECIPES[recipeName]), false);
  assert.equal(canCraft(enough, undefined), false, 'a missing recipe is not craftable');
});

test('the bench pages through every recipe', () => {
  const total = Object.keys(RECIPES).length;
  const first = craftPanel({ inventory: {} });
  assert.equal(first.pages, pageCount(total, RECIPES_PER_PAGE));
  const seen = new Set();
  for (let page = 0; page < first.pages; page += 1) {
    for (const row of craftPanel({ inventory: {}, page }).rows) seen.add(row.id);
  }
  assert.equal(seen.size, total);
});

test('every row says what it needs against what you hold', () => {
  const row = craftPanel({ inventory: short }).rows.find((r) => r.id === recipeName);
  assert.equal(row.ready, false);
  for (const material of row.materials) {
    assert.equal(material.need, recipeMats[material.id]);
    assert.equal(material.have, short[material.id]);
  }
});

test('the Craft button is dead until a recipe is selected AND affordable', () => {
  const craftBtn = (panel) => panel.buttons.find((b) => b.id === 'craft:make');
  assert.equal(craftBtn(craftPanel({ inventory: enough })).disabled, true, 'nothing selected');
  assert.equal(craftBtn(craftPanel({ inventory: short, selected: recipeName })).disabled, true, 'cannot afford it');
  assert.equal(craftBtn(craftPanel({ inventory: enough, selected: recipeName })).disabled, false);
});

test('the detail block names how many you are SHORT, not just that you are', () => {
  const body = craftPanel({ inventory: short, selected: recipeName }).lines.join('\n');
  assert.match(body, /missing materials/);
  assert.match(body, /\*\*1 short\*\*/);
});

test('a selection that is not a recipe is ignored rather than rendered', () => {
  const panel = craftPanel({ inventory: enough, selected: 'not_a_recipe' });
  assert.equal(panel.selected, null);
  assert.equal(panel.ready, false);
  assert.equal(panel.buttons.find((b) => b.id === 'craft:make').disabled, true);
});

// ── the custom id carries the state ──────────────────────────────────────────

test('panel state round-trips through the custom id', () => {
  const state = { view: 'craft', page: 2, selected: 'iron_shield', owner: '123' };
  const decoded = decodeId(encodeId('recipe', state));
  assert.deepEqual(decoded, { action: 'recipe', ...state });
});

test('"no selection" round-trips as null, not as an empty segment', () => {
  // An empty segment would make the id ambiguous to split.
  const id = encodeId('next', { view: 'job', page: 0, selected: null, owner: '9' });
  assert.doesNotMatch(id, /::/);
  assert.equal(decodeId(id).selected, null);
});

test('a custom id from another module is not ours', () => {
  assert.equal(decodeId('hst:join:abc'), null, 'the crew lobby keeps its own prefix');
  assert.equal(decodeId('cty:refresh:1'), null);
  assert.equal(decodeId(''), null);
  assert.equal(decodeId('hp:too:short'), null);
});

test('every custom id fits Discord’s 100-character limit', () => {
  // The longest realistic one: the longest recipe name plus an 18-digit id.
  const longest = Object.keys(RECIPES).reduce((a, b) => (a.length > b.length ? a : b));
  const id = encodeId('craft:make', { view: 'craft', page: 9, selected: longest, owner: '411157175948541954' });
  assert.ok(id.length <= 100, `${id.length} chars: ${id}`);
});
