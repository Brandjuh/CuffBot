import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setGuildData } from '../src/core/store.js';
import { ladderForGuild } from '../src/modules/academy/service.js';
import {
  getLadderSnapshot,
  getUsers,
  ladderStructureChanged,
  noteLadderMaybeChanged,
  reconcileLadderChange,
  saveLadderSnapshot,
  scheduleLadderReconcile,
  setXpConfig,
} from '../src/modules/leveling/service.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-ladder-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `30000000000000${String((seq += 1)).padStart(4, '0')}`;

// Default thresholds for a 3-rank ladder: [1000, 3482, 7225] (S45: base 1000, exp 1.8).

function fakeMember(guild, id, roleIds) {
  const member = {
    id,
    user: { bot: false },
    guild,
    roleLog: [],
    roles: {
      cache: new Map(roleIds.map((r) => [r, true])),
      add: async (roleId, reason) => {
        member.roles.cache.set(roleId, true);
        member.roleLog.push({ op: 'add', roleId, reason });
      },
      remove: async (ids, reason) => {
        for (const roleId of Array.isArray(ids) ? ids : [ids]) {
          member.roles.cache.delete(roleId);
          member.roleLog.push({ op: 'remove', roleId, reason });
        }
      },
    },
  };
  return member;
}

/**
 * A pinned 3-rank precinct: header [LEVELER] with Chief > Officer > Rookie
 * under it. Roles as {id → {position}}; members as {id → heldRoleIds}.
 */
function fakePrecinct(guildId, { members = {} } = {}) {
  const roles = new Map([
    ['header', { id: 'header', name: '[LEVELER]', position: 10, managed: false }],
    ['chief', { id: 'chief', name: 'Chief', position: 9, managed: false }],
    ['officer', { id: 'officer', name: 'Officer', position: 8, managed: false }],
    ['rookie', { id: 'rookie', name: 'Rookie', position: 7, managed: false }],
  ]);
  const guild = {
    id: guildId,
    roles: { cache: roles, everyone: { id: 'everyone' } },
    client: { config: { homeGuildId: guildId }, memberEventsAvailable: false },
    members: { cache: new Map() },
  };
  for (const [id, held] of Object.entries(members)) {
    guild.members.cache.set(id, fakeMember(guild, id, held));
  }
  setGuildData(guildId, 'academyConfig', { headerRoleId: 'header', excludedRoleIds: [] });
  return guild;
}

test('baseline: first pinned sight snapshots the ladder and seeds rank holders', async () => {
  const guildId = freshGuildId();
  const guild = fakePrecinct(guildId, { members: { officerHolder: ['officer'], bystander: [] } });

  const result = await noteLadderMaybeChanged(guild);
  assert.equal(result.reason, 'baseline');
  assert.equal(result.seeded, 1, 'the rank holder got an XP record, the bystander did not');
  assert.deepEqual(getLadderSnapshot(guildId).roleIds, ['chief', 'officer', 'rookie']);
  assert.equal(getUsers(guildId).officerHolder.xp, 3_482, 'seeded at the held rank floor');
  assert.equal(getUsers(guildId).bystander, undefined);

  assert.equal((await noteLadderMaybeChanged(guild)).reason, 'unchanged', 'stable ladder = no-op');
});

test('renaming a rank role is not a structure change', async () => {
  const guildId = freshGuildId();
  const guild = fakePrecinct(guildId);
  await noteLadderMaybeChanged(guild);
  guild.roles.cache.get('officer').name = 'Sergeant';
  assert.equal(ladderStructureChanged(guildId, ladderForGuild(guild)), false);
  assert.equal((await noteLadderMaybeChanged(guild)).reason, 'unchanged');
});

test('deleting a rank: ex-holders quietly get the rank their XP earns under the new ladder', async () => {
  const guildId = freshGuildId();
  const guild = fakePrecinct(guildId, { members: { exOfficer: ['officer'] } });
  await noteLadderMaybeChanged(guild); // baseline seeds exOfficer at 3482

  // Discord deletes the role everywhere: from the guild AND from members.
  guild.roles.cache.delete('officer');
  guild.members.cache.get('exOfficer').roles.cache.delete('officer');

  const result = await noteLadderMaybeChanged(guild, { sweepDelayMs: 0 });
  assert.equal(result.swept, true);
  assert.equal(result.roleChanges, 1);
  const member = guild.members.cache.get('exOfficer');
  // New 2-rank ladder thresholds: [1000, 3482] — 3482 XP now earns the top rank.
  assert.ok(member.roles.cache.has('chief'), 'reassigned to what 3482 XP earns now');
  assert.match(member.roleLog.at(-1).reason, /ladder-change reconciliation/);
  assert.deepEqual(getLadderSnapshot(guildId).roleIds, ['chief', 'rookie'], 'snapshot updated');
});

test('reordering: held ranks stay, XP heals up to the new floor (never down)', async () => {
  const guildId = freshGuildId();
  const guild = fakePrecinct(guildId, { members: { rookieHolder: ['rookie'] } });
  await noteLadderMaybeChanged(guild); // rookieHolder seeded at 1000

  // Owner drags Rookie to the top: Rookie > Chief > Officer.
  guild.roles.cache.get('rookie').position = 9.5;
  guild.roles.cache.get('chief').position = 8.5;
  guild.roles.cache.get('officer').position = 7.5;

  const result = await noteLadderMaybeChanged(guild, { sweepDelayMs: 0 });
  assert.equal(result.swept, true);
  assert.equal(result.healed, 1, 'XP raised to the held rank’s new floor');
  assert.equal(getUsers(guildId).rookieHolder.xp, 7_225, 'Rookie is now the top rank (floor 7225)');
  assert.ok(guild.members.cache.get('rookieHolder').roles.cache.has('rookie'), 'role untouched');
  assert.equal(result.roleChanges, 0, 'no role writes for a pure reorder heal');
});

test('adding a rank: nobody changes role immediately; higher floors heal XP', async () => {
  const guildId = freshGuildId();
  const guild = fakePrecinct(guildId, { members: { chiefHolder: ['chief'] } });
  await noteLadderMaybeChanged(guild); // chiefHolder seeded at 7225

  guild.roles.cache.set('captain', { id: 'captain', name: 'Captain', position: 8.5, managed: false });

  const result = await noteLadderMaybeChanged(guild, { sweepDelayMs: 0 });
  assert.equal(result.swept, true);
  assert.equal(result.roleChanges, 0, 'promote-only: held rank at/above target = keep it');
  // 4-rank thresholds: [1000, 3482, 7225, 12126] — Chief (top) now needs 12126.
  assert.equal(getUsers(guildId).chiefHolder.xp, 12_126, 'healed to the held rank’s new floor');
  assert.ok(guild.members.cache.get('chiefHolder').roles.cache.has('chief'));
});

test('a human demotion survives reconciliation (XP was capped at the demoted floor)', async () => {
  const guildId = freshGuildId();
  const guild = fakePrecinct(guildId, { members: { demoted: ['rookie'] } });
  await noteLadderMaybeChanged(guild);
  // /demote coupled their XP down to Rookie's floor (1000) earlier.
  setGuildData(guildId, 'xpUsers', { demoted: { xp: 1_000, lastMessageAt: null, seededFromRank: null } });

  // Unrelated structure change: delete an empty rank (nobody held Officer).
  guild.roles.cache.delete('officer');
  const result = await noteLadderMaybeChanged(guild, { sweepDelayMs: 0 });
  assert.equal(result.swept, true);
  const member = guild.members.cache.get('demoted');
  assert.ok(member.roles.cache.has('rookie'), 'still Rookie');
  assert.ok(!member.roles.cache.has('chief'), 'never re-promoted past the human demotion');
  assert.equal(getUsers(guildId).demoted.xp, 1_000, 'capped XP stays authoritative');
});

test('reconciliation refuses to act on an unpinned ladder or when sync is off', async () => {
  const guildId = freshGuildId();
  const guild = fakePrecinct(guildId, { members: { m: ['officer'] } });
  setGuildData(guildId, 'academyConfig', { headerRoleId: null, excludedRoleIds: [] });
  assert.equal((await noteLadderMaybeChanged(guild)).reason, 'unpinned');
  assert.equal(getLadderSnapshot(guildId), null, 'no snapshot without a pin');

  setGuildData(guildId, 'academyConfig', { headerRoleId: 'header', excludedRoleIds: [] });
  setXpConfig(guildId, { syncRoles: false });
  saveLadderSnapshot(guildId, { ranks: [{ roleId: 'stale', name: 'x' }] });
  const result = await reconcileLadderChange(guild, ladderForGuild(guild));
  assert.equal(result.swept, false);
  assert.equal(result.reason, 'disabled');
  setXpConfig(guildId, { syncRoles: true });
});

test('scheduleLadderReconcile debounces a burst of role events into one sweep', async () => {
  const guildId = freshGuildId();
  const guild = fakePrecinct(guildId, { members: { exOfficer: ['officer'] } });
  await noteLadderMaybeChanged(guild);

  guild.roles.cache.delete('officer');
  guild.members.cache.get('exOfficer').roles.cache.delete('officer');

  assert.equal(scheduleLadderReconcile(guild, { delayMs: 15, sweepDelayMs: 0 }), true);
  assert.equal(scheduleLadderReconcile(guild, { delayMs: 15, sweepDelayMs: 0 }), true, 're-arms');
  await new Promise((resolve) => setTimeout(resolve, 60));

  const member = guild.members.cache.get('exOfficer');
  const adds = member.roleLog.filter((e) => e.op === 'add');
  assert.equal(adds.length, 1, 'the burst produced exactly one quiet role write');
  assert.deepEqual(getLadderSnapshot(guildId).roleIds, ['chief', 'rookie']);
});
