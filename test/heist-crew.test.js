// Heist slice D (S88 = M16.12, maxcogs port): the crew robbery — the pure
// shared-roll resolver, the lobby, the one-settlement-for-four rule — and the
// admin-tunable job table, item prices and payout events.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { HEISTS, ITEMS } from '../src/modules/heist/lib/tables.js';
import { resolveCrewHeist } from '../src/modules/heist/lib/resolve.js';
import {
  CREW_SIZE,
  buyItem,
  clearAllCrewLobbies,
  createCrewLobby,
  closeCrewLobby,
  eventMultiplier,
  getCrewLobby,
  getHeistSettings,
  getItemCost,
  getPlayer,
  joinCrewLobby,
  leaveCrewLobby,
  listHeistOverrides,
  readyJobs,
  resetHeistOverrides,
  settleActiveHeist,
  setHeistOverride,
  setItemPrice,
  startCrewHeist,
  startHeist,
  startHeistEvent,
  settleCrewHeist,
  stopHeistEvent,
  updatePlayer,
} from '../src/modules/heist/service.js';
import { crewOutcomeEmbed } from '../src/modules/heist/commands/heist.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-heist-crew-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
  clearAllCrewLobbies();
});

const NOW = 1_800_000_000_000;
let seq = 0;
const freshGuildId = () => `88000000000000${String((seq += 1)).padStart(4, '0')}`;

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
    pick: () => take(picks, 'pick'),
  };
}

const crewMember = (userId, over = {}) => ({
  userId,
  balance: 1_000_000,
  player: {
    inventory: {},
    equipped: { shield: null, tool: null },
    heat: 0,
    materialHeat: 0,
    debt: 0,
    xp: 0,
    stats: { success: 0, fail: 0, caught: 0 },
    ...over,
  },
});

const NO_ROLL = 0.95;

// ── the pure crew resolver ───────────────────────────────────────────────────

test('one shared roll decides for everyone, and the haul splits four ways', () => {
  const members = ['a', 'b', 'c', 'd'].map((id) => crewMember(id));
  const outcome = resolveCrewHeist(
    { heistType: 'crew_robbery', heist: HEISTS.crew_robbery, members, now: NOW },
    // shared: int(success)=20, float=0.1 → success; int(reward)=4_000_000.
    // then per member: float(police), float(material) — four pairs.
    scriptRng({
      ints: [20, 4_000_000],
      floats: [0.1, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL],
    }),
  );
  assert.equal(outcome.success, true);
  assert.equal(outcome.totalReward, 4_000_000);
  assert.equal(outcome.perMemberReward, 1_000_000, 'total // crew');
  assert.equal(outcome.members.length, 4);
  assert.ok(outcome.members.every((result) => result.reward === 1_000_000));
  assert.ok(outcome.members.every((result) => result.balanceDelta === 1_000_000));
  assert.ok(outcome.members.every((result) => result.xpGained === 300), 'crew XP is the job xpReward');
  assert.equal(outcome.anyCaught, false);
});

test('the shared roll ignores tool boosts and level bonuses (cog behavior)', () => {
  // A level-120 officer with a matching tool would push a SOLO job to its cap;
  // here the crew roll is the raw drawn percentage, nothing else.
  const members = [crewMember('a', { xp: 10_000_000, inventory: { elite_kit: 1 }, equipped: { shield: null, tool: 'elite_kit' } })];
  const outcome = resolveCrewHeist(
    { heistType: 'crew_robbery', heist: HEISTS.crew_robbery, members, now: NOW },
    scriptRng({ ints: [10, 1_000_000], floats: [0.12, NO_ROLL, NO_ROLL] }),
  );
  assert.equal(outcome.baseSuccess, 10);
  assert.equal(outcome.success, false, '0.12 is not < 0.10 — no bonus rescued it');
  assert.equal(outcome.members[0].toolUsed, null, 'elite_kit is for the elite job, not crew robbery');
});

test('a failed crew job splits the loss, and each shield works on its own share', () => {
  const members = [
    crewMember('a'),
    crewMember('b', { inventory: { steel_shield: 1 }, equipped: { shield: 'steel_shield', tool: null } }),
    crewMember('c', { balance: 0 }),
    crewMember('d'),
  ];
  members[2].balance = 0; // can't pay — takes debt
  const outcome = resolveCrewHeist(
    { heistType: 'crew_robbery', heist: HEISTS.crew_robbery, members, now: NOW },
    scriptRng({
      ints: [20, 200_000],
      floats: [0.9, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL],
    }),
  );
  assert.equal(outcome.success, false);
  assert.equal(outcome.totalLoss, 200_000);
  assert.equal(outcome.perMemberLoss, 50_000);
  assert.equal(outcome.members[0].lossPaid, 50_000);
  assert.equal(outcome.members[1].lossPaid, 46_500, 'int(50000 × (1 − 0.07))');
  assert.equal(outcome.members[1].shieldUsed, 'steel_shield');
  assert.equal(outcome.members[2].lossPaid, 0);
  assert.equal(outcome.members[2].debtAdded, 50_000, 'no tax — the crew path never agrees to one');
  assert.equal(outcome.members[2].debtTax, 0);
});

test('police rolls are per officer: some walk, some do not', () => {
  const members = ['a', 'b'].map((id) => crewMember(id));
  const outcome = resolveCrewHeist(
    { heistType: 'crew_robbery', heist: HEISTS.crew_robbery, members, now: NOW },
    // a: police 0.001 → caught (uniform for bail), material NO_ROLL.
    // b: police NO_ROLL → clean, material NO_ROLL.
    scriptRng({ ints: [20, 2_000_000], floats: [0.1, 0.001, NO_ROLL, NO_ROLL, NO_ROLL], uniforms: [0.5] }),
  );
  assert.equal(outcome.anyCaught, true);
  assert.equal(outcome.members[0].caught, true);
  assert.equal(outcome.members[0].jail.bail, 150_000, 'int(max_loss 300000 × 0.5)');
  assert.equal(outcome.members[0].jail.bailTotal, 172_500);
  assert.equal(outcome.members[0].xpGained, 0, 'caught pays no XP');
  assert.equal(outcome.members[0].nextState.heat, 0, 'the arrest clears it');
  assert.equal(outcome.members[1].caught, false);
  assert.equal(outcome.members[1].nextState.heat, 1);
  assert.equal(outcome.members[1].xpGained, 300);
});

test('crew material drops roll AFTER the police check and are always 1–2', () => {
  const members = [crewMember('a')];
  const outcome = resolveCrewHeist(
    { heistType: 'crew_robbery', heist: HEISTS.crew_robbery, members, now: NOW },
    // The order proves itself: the police float comes first, then the drop.
    scriptRng({ ints: [20, 1_000_000, 2], floats: [0.1, NO_ROLL, 0.1], picks: ['rare_alloy'] }),
  );
  assert.deepEqual(outcome.members[0].materialDrop, { item: 'rare_alloy', qty: 2 });
  assert.equal(outcome.members[0].nextState.inventory.rare_alloy, 2);
  assert.equal(outcome.members[0].nextState.materialHeat, 0, 'reset on a drop');
});

// ── the lobby ────────────────────────────────────────────────────────────────

test('the lobby holds four, the organiser is in by default and cannot leave', () => {
  const guildId = freshGuildId();
  const { lobby } = createCrewLobby('chan', guildId, 'host');
  assert.deepEqual(lobby.members, ['host']);
  assert.equal(createCrewLobby('chan', guildId, 'other').error, 'busy');
  assert.equal(joinCrewLobby(lobby, 'host'), 'already');
  assert.equal(joinCrewLobby(lobby, 'b'), 'joined');
  assert.equal(joinCrewLobby(lobby, 'c'), 'joined');
  assert.equal(joinCrewLobby(lobby, 'd'), 'joined');
  assert.equal(lobby.members.length, CREW_SIZE);
  assert.equal(joinCrewLobby(lobby, 'e'), 'full');
  assert.equal(leaveCrewLobby(lobby, 'host'), 'organiser');
  assert.equal(leaveCrewLobby(lobby, 'b'), 'left');
  assert.equal(leaveCrewLobby(lobby, 'b'), 'not-joined');
  closeCrewLobby('chan');
  assert.equal(getCrewLobby('chan'), null);
});

// ── one settlement for four officers ─────────────────────────────────────────

test('a crew job is settled once by the leader; members delegate instead of re-rolling', async () => {
  const guildId = freshGuildId();
  const crew = ['leader', 'b', 'c', 'd'];
  const before = Object.fromEntries(crew.map((id) => [id, balanceOf(guildId, id)]));
  const { endsAt, leader } = startCrewHeist(guildId, crew, 'chan', { now: NOW });
  assert.equal(leader, 'leader');
  assert.equal(endsAt, NOW + HEISTS.crew_robbery.durationMs);
  for (const id of crew) {
    assert.deepEqual(getPlayer(guildId, id, NOW).activeHeist.crew, crew, `${id} carries the crew`);
  }

  // A member's own command settles the WHOLE crew (delegating to the leader).
  const outcome = await settleActiveHeist(guildId, 'c', {
    now: endsAt,
    rng: scriptRng({
      ints: [20, 4_000_000],
      floats: [0.1, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL],
    }),
  });
  assert.ok(outcome.members, 'a crew outcome');
  assert.equal(outcome.channelId, 'chan');
  for (const id of crew) {
    assert.equal(getPlayer(guildId, id, endsAt).activeHeist, null, `${id} is free again`);
    assert.equal(balanceOf(guildId, id), before[id] + 1_000_000, `${id} was paid their share`);
  }
  // Nothing left to settle for anyone — no second roll.
  assert.equal(await settleActiveHeist(guildId, 'leader', { now: endsAt }), null);
  assert.equal(await settleActiveHeist(guildId, 'b', { now: endsAt }), null);
});

test('settling a crew job before its clock runs out does nothing', async () => {
  const guildId = freshGuildId();
  const { endsAt } = startCrewHeist(guildId, ['leader', 'b', 'c', 'd'], 'chan', { now: NOW });
  assert.equal(await settleCrewHeist(guildId, 'leader', { now: endsAt - 1000 }), null);
  assert.ok(getPlayer(guildId, 'leader', NOW).activeHeist, 'still out on the job');
});

test('the crew card names the haul, each share and who got caught', () => {
  const embed = crewOutcomeEmbed({
    success: true,
    anyCaught: true,
    totalReward: 4_000_000,
    perMemberReward: 1_000_000,
    eventMultiplier: 2,
    members: [
      { userId: 'a', reward: 1_000_000, lossPaid: 0, debtAdded: 0, caught: false, jail: null, materialDrop: null, xpGained: 300, oldLevel: 5, newLevel: 6 },
      { userId: 'b', reward: 1_000_000, lossPaid: 0, debtAdded: 0, caught: true, jail: { endsAt: NOW, bailTotal: 172_500 }, materialDrop: { item: 'rare_alloy', qty: 2 }, xpGained: 0, oldLevel: 4, newLevel: 4 },
    ],
  }).toJSON();
  assert.match(embed.title, /Crew Robbery — ✅ Success - 🚨 Some Caught/);
  assert.match(embed.description, /Total haul:\*\* 4,000,000 🍩 split 2 ways/);
  assert.match(embed.description, /2× event active/);
  assert.match(embed.description, /Got away clean/);
  assert.match(embed.description, /Caught — jail until/);
  assert.match(embed.description, /Level up/);
});

// ── admin tuning ─────────────────────────────────────────────────────────────

test('overrides layer over the cog defaults and reset cleanly', () => {
  const guildId = freshGuildId();
  assert.deepEqual(getHeistSettings(guildId, 'bank'), HEISTS.bank, 'untouched = the ported table');

  assert.deepEqual(setHeistOverride(guildId, 'bank', 'maxReward', '750000'), { ok: true, value: 750_000 });
  assert.deepEqual(setHeistOverride(guildId, 'bank', 'cooldownMs', '900'), { ok: true, value: 900_000 }, 'typed in seconds, stored in ms');
  const tuned = getHeistSettings(guildId, 'bank');
  assert.equal(tuned.maxReward, 750_000);
  assert.equal(tuned.cooldownMs, 900_000);
  assert.equal(tuned.minReward, HEISTS.bank.minReward, 'untouched fields keep the default');
  assert.deepEqual(listHeistOverrides(guildId).bank, { maxReward: 750_000, cooldownMs: 900_000 });

  assert.equal(setHeistOverride(guildId, 'nope', 'maxReward', '1').error, 'unknown-job');
  assert.equal(setHeistOverride(guildId, 'bank', 'emoji', 'x').error, 'unknown-field');
  assert.equal(setHeistOverride(guildId, 'bank', 'maxReward', 'lots').error, 'not-a-number');
  const range = setHeistOverride(guildId, 'bank', 'minSuccess', '150');
  assert.equal(range.error, 'out-of-range');
  assert.deepEqual([range.min, range.max], [0, 100]);

  assert.equal(resetHeistOverrides(guildId, 'bank'), 2, 'two fields cleared');
  assert.deepEqual(getHeistSettings(guildId, 'bank'), HEISTS.bank);
  setHeistOverride(guildId, 'bank', 'maxReward', '1');
  setHeistOverride(guildId, 'elite', 'maxReward', '2');
  assert.equal(resetHeistOverrides(guildId), 2, 'a bare reset clears every job');
  assert.deepEqual(listHeistOverrides(guildId), {});
});

test('a tuned cooldown drives the ready list and a tuned duration the deadline', () => {
  const guildId = freshGuildId();
  setHeistOverride(guildId, 'bank', 'cooldownMs', '60'); // one minute instead of six hours
  startHeist(guildId, 'alice', 'bank', 'chan', { now: NOW });
  const player = getPlayer(guildId, 'alice', NOW);
  assert.ok(!readyJobs(player, NOW, guildId).includes('bank'), 'still cooling down at the start');
  assert.ok(readyJobs(player, NOW + 61_000, guildId).includes('bank'), 'ready a minute later');
  assert.ok(!readyJobs(player, NOW + 61_000).includes('bank'), 'without the guild it measures the default 6 h');

  setHeistOverride(guildId, 'vending_machine', 'durationMs', '5');
  const { endsAt } = startHeist(guildId, 'bob', 'vending_machine', 'chan', { now: NOW });
  assert.equal(endsAt, NOW + 5000, 'the tuned duration is what the timer waits for');
});

test('item prices can be overridden, and buying charges the new price', async () => {
  const guildId = freshGuildId();
  assert.equal(getItemCost(guildId, 'crowbar'), ITEMS.crowbar.cost);
  assert.equal(setItemPrice(guildId, 'jewelry', 100).error, 'not-for-sale');
  assert.equal(setItemPrice(guildId, 'crowbar', -5).error, 'out-of-range');
  assert.deepEqual(setItemPrice(guildId, 'crowbar', 50), { ok: true, cost: 50 });
  assert.equal(getItemCost(guildId, 'crowbar'), 50);

  const before = balanceOf(guildId, 'alice');
  const bought = await buyItem(guildId, 'alice', 'crowbar', 2, NOW);
  assert.deepEqual(bought, { ok: true, cost: 100 }, 'two at the tuned price');
  assert.equal(balanceOf(guildId, 'alice'), before - 100);
});

test('a payout event multiplies rewards until it expires', async () => {
  const guildId = freshGuildId();
  assert.equal(eventMultiplier(guildId, NOW), 1, 'no event by default');
  assert.equal(startHeistEvent(guildId, 9, 1, NOW).error, 'bad-multiplier');
  assert.equal(startHeistEvent(guildId, 3, 0, NOW).error, 'bad-duration');
  const started = startHeistEvent(guildId, 3, 2, NOW);
  assert.equal(started.ok, true);
  assert.equal(eventMultiplier(guildId, NOW), 3);
  assert.equal(eventMultiplier(guildId, NOW + 3 * 3_600_000), 1, 'expired events read as 1×');

  // A crew haul during the event pays triple.
  updatePlayer(guildId, 'a', (p) => p, NOW);
  const { endsAt } = startCrewHeist(guildId, ['a', 'b', 'c', 'd'], 'chan', { now: NOW });
  const before = balanceOf(guildId, 'a');
  const outcome = await settleCrewHeist(guildId, 'a', {
    now: endsAt,
    rng: scriptRng({
      ints: [20, 1_000_000],
      floats: [0.1, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL, NO_ROLL],
    }),
  });
  assert.equal(outcome.totalReward, 3_000_000, '1,000,000 drawn × 3');
  assert.equal(balanceOf(guildId, 'a'), before + 750_000);
  stopHeistEvent(guildId);
  assert.equal(eventMultiplier(guildId, NOW), 1);
});
