// Heist slice B (S86 = M16.12, maxcogs port): the storage layer, the cog's
// gates (jail → debt → active job → cooldown), the economy seam, and the
// lazy settlement that turns a finished job into a result. The pure engine
// itself is covered by test/heist.test.js.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import { HEISTS } from '../src/modules/heist/lib/tables.js';
import { XP_TABLE } from '../src/modules/heist/lib/leveling.js';
import {
  buyItem,
  cooldownLeft,
  craftItem,
  equipItem,
  getPlayer,
  jailStatus,
  payBail,
  payDebt,
  readyJobs,
  savePlayer,
  sellItem,
  settleActiveHeist,
  shopItems,
  startHeist,
  unequipSlot,
  updatePlayer,
} from '../src/modules/heist/service.js';
import heistCommand, { outcomeEmbed } from '../src/modules/heist/commands/heist.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-heist-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const HOUR = 3_600_000;
const NOW = 1_800_000_000_000;
let seq = 0;
const freshGuildId = () => `86000000000000${String((seq += 1)).padStart(4, '0')}`;

const { balanceOf, adjustBalance } = await import('../src/modules/economy/service.js');

/** Scripted rng, same contract as the slice-A tests. */
function scriptRng({ ints = [], floats = [], uniforms = [], picks = [] } = {}) {
  const take = (queue, what) => {
    if (queue.length === 0) throw new Error(`rng.${what} exhausted`);
    return queue.shift();
  };
  return {
    int: () => take(ints, 'int'),
    float: () => take(floats, 'float'),
    uniform: () => take(uniforms, 'uniform'),
    pick: () => take(picks, 'pick'),
  };
}

// ── storage + heat decay ─────────────────────────────────────────────────────

test('a fresh player is fully shaped; writes round-trip', () => {
  const guildId = freshGuildId();
  const player = getPlayer(guildId, 'alice', NOW);
  assert.deepEqual(player.equipped, { shield: null, tool: null });
  assert.deepEqual(player.stats, { success: 0, fail: 0, caught: 0 });
  assert.deepEqual(player.inventory, {});
  assert.equal(player.debt, 0);
  assert.equal(player.jail, null);
  assert.equal(player.activeHeist, null);

  updatePlayer(guildId, 'alice', (p) => ({ ...p, xp: 500, inventory: { crowbar: 2 } }), NOW);
  const stored = getPlayer(guildId, 'alice', NOW);
  assert.equal(stored.xp, 500);
  assert.equal(stored.inventory.crowbar, 2);
});

test('heat is decayed at READ time, without writing anything back', () => {
  const guildId = freshGuildId();
  savePlayer(guildId, 'alice', { ...getPlayer(guildId, 'alice', NOW), heat: 6, heatLastSet: NOW - 9 * HOUR });
  // 9 idle hours = 4 full two-hour steps.
  assert.equal(getPlayer(guildId, 'alice', NOW).heat, 2);
  // Reading again from a later clock decays from the ORIGINAL stamp, so the
  // schedule can't be gamed by looking more often (deviation from the cog,
  // which rewrote the stamp on every read).
  assert.equal(getPlayer(guildId, 'alice', NOW + 2 * HOUR).heat, 1);
  assert.equal(getPlayer(guildId, 'alice', NOW + 100 * HOUR).heat, 0);
});

// ── gates ────────────────────────────────────────────────────────────────────

test('jail status reports bail with the 15% tax and expires on its own', () => {
  const free = jailStatus({ jail: null }, NOW);
  assert.deepEqual(free, { jailed: false });
  const jailed = jailStatus({ jail: { endsAt: NOW + HOUR, bail: 1000 } }, NOW);
  assert.deepEqual(jailed, { jailed: true, endsAt: NOW + HOUR, bail: 1000, total: 1150 });
  assert.deepEqual(jailStatus({ jail: { endsAt: NOW - 1, bail: 1000 } }, NOW), { jailed: false }, 'served');
});

test('cooldowns count from the START of a job and gate the ready list', () => {
  const guildId = freshGuildId();
  startHeist(guildId, 'alice', 'atm_smash', 'chan', { now: NOW });
  const player = getPlayer(guildId, 'alice', NOW);
  assert.equal(cooldownLeft(player, 'atm_smash', NOW), HEISTS.atm_smash.cooldownMs);
  assert.equal(cooldownLeft(player, 'bank', NOW), 0, 'other jobs are unaffected');
  assert.equal(cooldownLeft(player, 'atm_smash', NOW + HEISTS.atm_smash.cooldownMs), 0, 'expired');

  const ready = readyJobs(player, NOW);
  assert.ok(!ready.includes('atm_smash'));
  assert.ok(!ready.includes('crew_robbery'), 'crew jobs are excluded until slice D');
  assert.equal(ready.length, 22, '23 solo jobs minus the one cooling down');
});

test('starting a job stamps the cooldown, the deadline and the tax consent', () => {
  const guildId = freshGuildId();
  const { endsAt } = startHeist(guildId, 'bob', 'bank', 'chan-1', { taxAgreed: true, now: NOW });
  assert.equal(endsAt, NOW + HEISTS.bank.durationMs);
  const player = getPlayer(guildId, 'bob', NOW);
  assert.deepEqual(player.activeHeist, { type: 'bank', endsAt, channelId: 'chan-1', taxAgreed: true });
  assert.equal(player.cooldowns.bank, NOW);
});

// ── lazy settlement ──────────────────────────────────────────────────────────

test('settling does nothing while the job is still running', async () => {
  const guildId = freshGuildId();
  startHeist(guildId, 'alice', 'atm_smash', 'chan', { now: NOW });
  assert.equal(await settleActiveHeist(guildId, 'alice', { now: NOW + 1000 }), null, 'not done yet');
  assert.ok(getPlayer(guildId, 'alice', NOW).activeHeist, 'still running');
  assert.equal(await settleActiveHeist(guildId, 'bob', { now: NOW }), null, 'nobody with no job');
});

test('a finished job settles once: state applied, donuts paid, job cleared', async () => {
  const guildId = freshGuildId();
  const before = balanceOf(guildId, 'alice');
  startHeist(guildId, 'alice', 'atm_smash', 'chan', { now: NOW });
  const done = NOW + HEISTS.atm_smash.durationMs;
  const outcome = await settleActiveHeist(guildId, 'alice', {
    now: done,
    rng: scriptRng({ ints: [50, 2000], floats: [0.1, 0.95, 0.95] }),
  });
  assert.equal(outcome.success, true);
  assert.equal(outcome.reward, 2000);
  assert.equal(outcome.paid, true);
  assert.equal(outcome.channelId, 'chan', 'the caller learns where to announce it');
  assert.equal(balanceOf(guildId, 'alice'), before + 2000, 'donuts really moved');

  const player = getPlayer(guildId, 'alice', done);
  assert.equal(player.activeHeist, null, 'cleared');
  assert.equal(player.stats.success, 1);
  assert.equal(player.xp, 30);
  assert.equal(player.heat, 1);
  assert.equal(player.cooldowns.atm_smash, NOW, 'the cooldown survives settlement');
  assert.equal(await settleActiveHeist(guildId, 'alice', { now: done }), null, 'settling twice is a no-op');
});

test('an arrest during settlement lands the player in jail with bail owed', async () => {
  const guildId = freshGuildId();
  startHeist(guildId, 'carol', 'atm_smash', 'chan', { now: NOW });
  const done = NOW + HEISTS.atm_smash.durationMs;
  const outcome = await settleActiveHeist(guildId, 'carol', {
    now: done,
    rng: scriptRng({ ints: [50, 2000], floats: [0.1, 0.95, 0.001], uniforms: [0.5] }),
  });
  assert.equal(outcome.caught, true);
  const player = getPlayer(guildId, 'carol', done);
  assert.deepEqual(player.jail, { endsAt: done + HEISTS.atm_smash.jailMs, bail: 750 });
  assert.equal(jailStatus(player, done).total, 862, '750 + 15% tax, truncated');
  assert.equal(player.heat, 0, 'an arrest wipes the record');
  assert.equal(player.xp, 0, 'no XP when caught');
});

test('a loss beyond the balance becomes debt, and paydebt clears what it can', async () => {
  const guildId = freshGuildId();
  adjustBalance(guildId, 'dave', -balanceOf(guildId, 'dave')); // start broke
  startHeist(guildId, 'dave', 'atm_smash', 'chan', { taxAgreed: true, now: NOW });
  const done = NOW + HEISTS.atm_smash.durationMs;
  const outcome = await settleActiveHeist(guildId, 'dave', {
    now: done,
    rng: scriptRng({ ints: [50, 1000], floats: [0.99, 0.95, 0.95] }),
  });
  assert.equal(outcome.success, false);
  assert.equal(outcome.debtAdded, 1200, '1000 + 20% tax');
  assert.equal(getPlayer(guildId, 'dave', done).debt, 1200);

  adjustBalance(guildId, 'dave', 500);
  const partial = await payDebt(guildId, 'dave', done);
  assert.deepEqual(partial, { paid: 500, remaining: 700 });
  assert.equal(balanceOf(guildId, 'dave'), 0);
  adjustBalance(guildId, 'dave', 1000);
  const rest = await payDebt(guildId, 'dave', done);
  assert.deepEqual(rest, { paid: 700, remaining: 0 });
  assert.equal(balanceOf(guildId, 'dave'), 300);
});

// ── shop, inventory, crafting, bail ──────────────────────────────────────────

test('the shop sells exactly the priced items and buying moves donuts', async () => {
  const guildId = freshGuildId();
  const forSale = shopItems();
  assert.equal(forSale.length, 29, '6 shields + 23 tools carry a price');
  assert.ok(forSale.every((item) => item.type === 'shield' || item.type === 'tool'));
  assert.ok(!forSale.some((item) => item.id.startsWith('enhanced_')), 'crafted gear is never for sale');

  const before = balanceOf(guildId, 'alice');
  const bought = await buyItem(guildId, 'alice', 'crowbar', 2, NOW);
  assert.deepEqual(bought, { ok: true, cost: 600 });
  assert.equal(balanceOf(guildId, 'alice'), before - 600);
  assert.equal(getPlayer(guildId, 'alice', NOW).inventory.crowbar, 2);

  assert.equal((await buyItem(guildId, 'alice', 'jewelry', 1, NOW)).error, 'not-for-sale');
  assert.equal((await buyItem(guildId, 'alice', 'crowbar', 0, NOW)).error, 'bad-amount');
  const broke = await buyItem(guildId, 'alice', 'full', 1, NOW);
  assert.equal(broke.error, 'poor');
  assert.equal(broke.need, 100_000);
});

test('equip refuses what you do not own and tracks the right slot', () => {
  const guildId = freshGuildId();
  assert.equal(equipItem(guildId, 'alice', 'crowbar', NOW).error, 'not-owned');
  updatePlayer(guildId, 'alice', (p) => ({ ...p, inventory: { crowbar: 1, jewelry: 1, iron_shield: 1 } }), NOW);
  assert.deepEqual(equipItem(guildId, 'alice', 'crowbar', NOW), { ok: true, slot: 'tool' });
  assert.deepEqual(equipItem(guildId, 'alice', 'iron_shield', NOW), { ok: true, slot: 'shield' });
  assert.deepEqual(getPlayer(guildId, 'alice', NOW).equipped, { shield: 'iron_shield', tool: 'crowbar' });
  assert.equal(equipItem(guildId, 'alice', 'jewelry', NOW).error, 'not-equippable');
  assert.equal(equipItem(guildId, 'alice', 'nonsense', NOW).error, 'unknown-item');
  unequipSlot(guildId, 'alice', 'tool', NOW);
  assert.equal(getPlayer(guildId, 'alice', NOW).equipped.tool, null);
  assert.equal(unequipSlot(guildId, 'alice', 'hat', NOW).error, 'bad-slot');
});

test('selling rolls a price per unit and empties the stack', async () => {
  const guildId = freshGuildId();
  updatePlayer(guildId, 'alice', (p) => ({ ...p, inventory: { jewelry: 3 } }), NOW);
  const before = balanceOf(guildId, 'alice');
  const sold = await sellItem(guildId, 'alice', 'jewelry', 2, {
    now: NOW,
    rng: scriptRng({ ints: [5000, 15000] }),
  });
  assert.deepEqual(sold, { ok: true, amount: 2, price: 20_000 }, 'two independent rolls, summed');
  assert.equal(balanceOf(guildId, 'alice'), before + 20_000);
  assert.equal(getPlayer(guildId, 'alice', NOW).inventory.jewelry, 1);

  assert.equal((await sellItem(guildId, 'alice', 'jewelry', 5, { now: NOW })).error, 'not-enough');
  assert.equal((await sellItem(guildId, 'alice', 'crowbar', 1, { now: NOW })).error, 'not-sellable');
});

test('crafting spends materials and hands over the enhanced item', () => {
  const guildId = freshGuildId();
  updatePlayer(guildId, 'alice', (p) => ({ ...p, inventory: { scrap_metal: 5, tech_parts: 1 } }), NOW);
  const made = craftItem(guildId, 'alice', 'reinforced_wooden_shield', NOW);
  assert.deepEqual(made, { ok: true, result: 'reinforced_wooden_shield', quantity: 1 });
  const inventory = getPlayer(guildId, 'alice', NOW).inventory;
  assert.equal(inventory.scrap_metal, undefined, 'spent');
  assert.equal(inventory.reinforced_wooden_shield, 1);
  assert.equal(craftItem(guildId, 'alice', 'reinforced_wooden_shield', NOW).error, 'missing');
  assert.equal(craftItem(guildId, 'alice', 'nope', NOW).error, 'unknown-recipe');
});

test('bail: the payer pays, the jailed walks, and heat is wiped', async () => {
  const guildId = freshGuildId();
  updatePlayer(guildId, 'jailbird', (p) => ({ ...p, jail: { endsAt: NOW + HOUR, bail: 1000 }, heat: 7, materialHeat: 4 }), NOW);
  assert.equal((await payBail(guildId, 'friend', 'free-man', NOW)).error, 'not-jailed');

  adjustBalance(guildId, 'friend', -balanceOf(guildId, 'friend'));
  adjustBalance(guildId, 'friend', 500);
  const poor = await payBail(guildId, 'friend', 'jailbird', NOW);
  assert.equal(poor.error, 'poor');
  assert.equal(poor.need, 1150);
  assert.ok(getPlayer(guildId, 'jailbird', NOW).jail, 'still inside');

  adjustBalance(guildId, 'friend', 1000);
  const paid = await payBail(guildId, 'friend', 'jailbird', NOW);
  assert.deepEqual(paid, { ok: true, total: 1150 });
  assert.equal(balanceOf(guildId, 'friend'), 350);
  const freed = getPlayer(guildId, 'jailbird', NOW);
  assert.equal(freed.jail, null);
  assert.equal(freed.heat, 0);
  assert.equal(freed.materialHeat, 0);
});

// ── rendering + group wiring ─────────────────────────────────────────────────

test('the outcome embed reports the money, the gear and the arrest', () => {
  const caught = outcomeEmbed(
    {
      heistType: 'bank',
      success: true,
      caught: true,
      reward: 5000,
      seized: 5000,
      lootItem: null,
      toolUsed: 'bank_drill',
      toolBoost: 0.16,
      materialDrop: { item: 'rare_alloy', qty: 2 },
      confiscated: null,
      jail: { endsAt: NOW, bail: 1000, bailTax: 150, bailTotal: 1150 },
      xpGained: 0,
      oldLevel: 3,
      newLevel: 3,
      nextState: { xp: 400, debt: 0 },
      lossPaid: 0,
      debtAdded: 0,
      shieldUsed: null,
      shieldAbsorbedAll: false,
    },
    'Alice',
  ).toJSON();
  assert.match(caught.title, /Bank — ✅ Success - 🚨 Caught/);
  assert.match(caught.description, /\+5,000 🍩/);
  assert.match(caught.description, /Police seized \*\*5,000 🍩\*\*/);
  assert.match(caught.description, /Bail: 1,000 \+ 150 tax = \*\*1,150\*\*/);
  assert.match(caught.description, /No XP earned \(caught\)/);
  assert.match(caught.description, /Found 2× Rare Alloy/);

  const busted = outcomeEmbed(
    {
      heistType: 'atm_smash',
      success: false,
      caught: false,
      reward: 0,
      seized: 0,
      lootItem: null,
      toolUsed: null,
      materialDrop: null,
      confiscated: null,
      jail: null,
      xpGained: 6,
      oldLevel: 1,
      newLevel: 2,
      nextState: { xp: XP_TABLE[1] + 5, debt: 1200 },
      lossPaid: 0,
      debtAdded: 1200,
      debtTax: 200,
      shieldUsed: 'iron_shield',
      shieldAbsorbedAll: false,
    },
    'Bob',
  ).toJSON();
  assert.match(busted.description, /1,200 🍩\*\* added to your debt \(incl\. 200 tax\)/);
  assert.match(busted.description, /Level up! 1 → 2/);
});

test('!heist group shape: public play, admin gated on Manage Server', () => {
  const group = heistCommand.group;
  assert.equal(group.name, 'heist');
  assert.equal(group.permission, undefined, 'the game itself is public');
  assert.equal(group.fallback, 'play');
  assert.deepEqual(
    group.subcommands.map((s) => s.name),
    [
      'play',
      'jobs',
      'shop',
      'buy',
      'equip',
      'unequip',
      'inventory',
      'sell',
      'craft',
      'bail',
      'paydebt',
      'crew',
      'admin',
      'level',
    ],
  );
  const gated = group.subcommands.filter((s) => s.permission !== undefined).map((s) => s.name);
  assert.deepEqual(gated, ['admin'], 'only the tuning surface is gated');
  assert.equal(group.subcommands.find((s) => s.name === 'admin').permission, PermissionFlagsBits.ManageGuild);
  assert.deepEqual(group.subcommands.find((s) => s.name === 'unequip').args[0].choices, ['shield', 'tool']);
});
