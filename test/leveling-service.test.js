import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { setGuildData } from '../src/core/store.js';
import {
  awardMessageXp,
  awardVoiceMinute,
  coupleXpToRank,
  ensureSeeded,
  getUserXp,
  getUsers,
  getXpConfig,
  leaderboard,
  setXpConfig,
  syncMemberRank,
} from '../src/modules/leveling/service.js';
import { thresholdsFor } from '../src/modules/leveling/lib/xp.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-leveling-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

// Each test uses its own guild id so store state never bleeds between tests.
let seq = 0;
function freshGuildId() {
  seq += 1;
  return `90000000000000${String(seq).padStart(4, '0')}`;
}

// A guild whose academy header is PINNED via /rank-setup — automation
// (seeding from rank, auto-sync, coupling) requires this.
function pinnedGuildId() {
  const guildId = freshGuildId();
  setGuildData(guildId, 'academyConfig', { headerRoleId: 'lvl-header', excludedRoleIds: [] });
  return guildId;
}

// The shape academy's buildLadder produces for a pinned header.
const LADDER = {
  headerFound: true,
  headerRoleId: 'lvl-header',
  ranks: [
    { roleId: 'r-legend', name: 'Legend' },
    { roleId: 'r-veteran', name: 'Veteran' },
    { roleId: 'r-regular', name: 'Regular' },
    { roleId: 'r-rookie', name: 'Rookie' },
  ],
};
// The same ladder as the name-heuristic would produce it (no admin pin).
const HEURISTIC_LADDER = { ...LADDER, headerRoleId: 'some-heuristic-header' };
const T = thresholdsFor(4, getXpConfig('000000000000000000'));

function fakeMember(id, roleIds = [], { editable = true } = {}) {
  const added = [];
  const removed = [];
  return {
    id,
    added,
    removed,
    displayName: `officer-${id}`,
    user: { username: `officer-${id}`, bot: false },
    guild: {
      id: null, // set after creation when syncMemberRank needs it
      roles: { cache: new Map(LADDER.ranks.map((r) => [r.roleId, { id: r.roleId, editable }])) },
    },
    roles: {
      cache: new Map(roleIds.map((rid) => [rid, { id: rid }])),
      add: async (idOrIds) => added.push(...[].concat(idOrIds)),
      remove: async (ids) => removed.push(...[].concat(ids)),
    },
  };
}

test('xp config: defaults are on, and patches persist', () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  assert.equal(config.enabled, true);
  assert.equal(config.syncRoles, true);
  setXpConfig(guild, { messageXp: 20, enabled: false });
  const next = getXpConfig(guild);
  assert.equal(next.messageXp, 20);
  assert.equal(next.enabled, false);
  assert.equal(next.voiceXpPerMin, 10, 'unpatched keys keep defaults');
});

test('setXpConfig stores only overrides, never frozen defaults (audit #8)', async () => {
  const guild = pinnedGuildId();
  setXpConfig(guild, { messageXp: 20 });
  const { getGuildData } = await import('../src/core/store.js');
  const stored = getGuildData(guild, 'xpConfig', {});
  assert.deepEqual(Object.keys(stored), ['messageXp'], 'defaults are not persisted');
});

test('first sight of a ranked member seeds XP from the rank they hold', () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  const member = fakeMember('u1', ['r-veteran']); // 2nd from top on a 4-rank ladder
  const record = ensureSeeded(guild, member, LADDER, config);
  assert.equal(record.xp, T[2], 'Veteran = 3rd from bottom → thresholds[2]');
  assert.equal(record.seededFromRank, 'Veteran');
  assert.equal(getUserXp(guild, 'u1'), T[2]);
});

test('first sight of a rankless member seeds 0 (new members start at 0)', () => {
  const guild = pinnedGuildId();
  const member = fakeMember('u2', []);
  const record = ensureSeeded(guild, member, LADDER, getXpConfig(guild));
  assert.equal(record.xp, 0);
  assert.equal(record.seededFromRank, null);
});

test('an UNPINNED ladder never seeds from rank (audit #1: no decoy-ladder seeding)', () => {
  const guild = freshGuildId(); // no academyConfig pin
  const member = fakeMember('u2b', ['r-legend']);
  const record = ensureSeeded(guild, member, HEURISTIC_LADDER, getXpConfig(guild));
  assert.equal(record.xp, 0, 'heuristic ladder must not drive seeding');
});

test('a record seeded under a broken ladder self-heals once the ladder is pinned (audit #1)', () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  const member = fakeMember('u2c', ['r-veteran']);
  // First sight happened while the ladder was broken → seeded 0.
  ensureSeeded(guild, member, { ranks: [], headerFound: false, headerRoleId: null }, config);
  assert.equal(getUserXp(guild, 'u2c'), 0);
  // Ladder is back (pinned): the next sight raises XP to the held rank's floor.
  const healed = ensureSeeded(guild, member, LADDER, config);
  assert.equal(healed.xp, T[2], 'healed to the Veteran floor');
  assert.equal(healed.seededFromRank, 'Veteran');
});

test('reconcile also lifts XP after a hand promotion above current XP', () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  ensureSeeded(guild, fakeMember('u2d', []), LADDER, config); // starts at 0
  // A mod hand-assigns Legend; the member's next award reconciles XP upward.
  const out = awardMessageXp(guild, fakeMember('u2d', ['r-legend']), LADDER, config, 5_000_000);
  assert.equal(out.xp, T[3] + config.messageXp, 'Legend floor + the message');
});

test('ensureSeeded never re-seeds or overwrites an existing record', () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  ensureSeeded(guild, fakeMember('u3', []), LADDER, config);
  awardMessageXp(guild, fakeMember('u3', []), LADDER, config, 1_000_000);
  const xpAfterMessage = getUserXp(guild, 'u3');
  // A rankless member keeps their earned XP — no re-seed to 0 or elsewhere.
  const again = ensureSeeded(guild, fakeMember('u3', []), LADDER, config);
  assert.equal(again.xp, xpAfterMessage, 'existing record untouched');
});

test('awardMessageXp seeds on first sight, then adds message XP on top', () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  const out = awardMessageXp(guild, fakeMember('u4', ['r-rookie']), LADDER, config, 1_000_000);
  assert.equal(out.seeded, true);
  assert.equal(out.gained, config.messageXp);
  assert.equal(out.xp, T[0] + config.messageXp, 'seeded floor + first message');
});

test('awardMessageXp honors the cooldown', () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  const member = fakeMember('u5', []);
  const first = awardMessageXp(guild, member, LADDER, config, 1_000_000);
  assert.equal(first.gained, config.messageXp);
  const spam = awardMessageXp(guild, member, LADDER, config, 1_000_000 + 5_000);
  assert.equal(spam.gained, 0, 'within cooldown pays nothing');
  const later = awardMessageXp(guild, member, LADDER, config, 1_000_000 + config.messageCooldownMs);
  assert.equal(later.gained, config.messageXp);
  assert.equal(getUserXp(guild, 'u5'), config.messageXp * 2);
});

test('awardVoiceMinute pays one minute of voice XP and stacks with messages', () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  const member = fakeMember('u6', []);
  awardVoiceMinute(guild, member, LADDER, config);
  awardVoiceMinute(guild, member, LADDER, config);
  assert.equal(getUserXp(guild, 'u6'), config.voiceXpPerMin * 2);
});

test('leaderboard sorts by XP, highest first, and respects the limit', () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  awardVoiceMinute(guild, fakeMember('low', []), LADDER, config);
  ensureSeeded(guild, fakeMember('high', ['r-legend']), LADDER, config);
  ensureSeeded(guild, fakeMember('mid', ['r-rookie']), LADDER, config);
  const rows = leaderboard(guild, 2);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.userId), ['high', 'mid']);
});

test('leaderboard clamps nonsense limits instead of misbehaving (audit #3)', () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  ensureSeeded(guild, fakeMember('a', ['r-rookie']), LADDER, config);
  ensureSeeded(guild, fakeMember('b', []), LADDER, config);
  assert.equal(leaderboard(guild, 0).length, 1, '0 clamps to 1');
  assert.equal(leaderboard(guild, -3).length, 1, 'negative clamps to 1');
  assert.equal(leaderboard(guild, 500).length, 2, 'huge asks return what exists (≤25)');
});

function withGuildId(member, guildId) {
  member.guild.id = guildId;
  return member;
}

test('syncMemberRank promotes when XP earns a higher rank', async () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  const member = withGuildId(fakeMember('u7', ['r-rookie']), guild);
  const sync = await syncMemberRank(member, LADDER, T[1], config); // earns Regular
  assert.equal(sync.changed, true);
  assert.equal(sync.from, 'Rookie');
  assert.equal(sync.to, 'Regular');
  assert.deepEqual(member.added, ['r-regular']);
  assert.deepEqual(member.removed, ['r-rookie']);
});

test('syncMemberRank never demotes a member holding a higher rank', async () => {
  const guild = pinnedGuildId();
  const member = withGuildId(fakeMember('u8', ['r-legend']), guild);
  const sync = await syncMemberRank(member, LADDER, T[0], getXpConfig(guild)); // XP only earns Rookie
  assert.equal(sync.changed, false);
  assert.equal(member.added.length, 0);
  assert.equal(member.removed.length, 0);
});

test('syncMemberRank respects the syncRoles=false switch', async () => {
  const guild = pinnedGuildId();
  setXpConfig(guild, { syncRoles: false });
  const member = withGuildId(fakeMember('u9', []), guild);
  const sync = await syncMemberRank(member, LADDER, T[3], getXpConfig(guild));
  assert.equal(sync.changed, false);
  assert.equal(member.added.length, 0);
});

test('syncMemberRank stays idle on an UNPINNED ladder (audit #1: no decoy role grants)', async () => {
  const guild = freshGuildId(); // no pin
  const member = withGuildId(fakeMember('u9b', []), guild);
  const sync = await syncMemberRank(member, HEURISTIC_LADDER, T[3], getXpConfig(guild));
  assert.equal(sync.changed, false);
  assert.equal(member.added.length, 0, 'no roles handed out from a guessed ladder');
});

test('syncMemberRank reports blocked when the role sits above the bot', async () => {
  const guild = pinnedGuildId();
  const member = withGuildId(fakeMember('u10', [], { editable: false }), guild);
  const sync = await syncMemberRank(member, LADDER, T[0], getXpConfig(guild));
  assert.equal(sync.changed, false);
  assert.equal(sync.blocked, true);
  assert.equal(member.added.length, 0);
});

test('concurrent syncs for the same member promote only once (audit #2)', async () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  const member = withGuildId(fakeMember('u11', []), guild);
  // Make the first sync hold the in-flight slot across an await.
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const originalAdd = member.roles.add;
  member.roles.add = async (ids) => {
    await gate;
    return originalAdd(ids);
  };
  const first = syncMemberRank(member, LADDER, T[0], config);
  const second = await syncMemberRank(member, LADDER, T[0], config); // interleaved
  assert.equal(second.changed, false, 'second sync is refused while the first is in flight');
  release();
  const firstResult = await first;
  assert.equal(firstResult.changed, true);
  assert.deepEqual(member.added, ['r-rookie'], 'exactly one promotion executed');
});

test('coupleXpToRank: a hand promotion raises XP to the new floor', () => {
  const guild = pinnedGuildId();
  ensureSeeded(guild, fakeMember('u12', []), LADDER, getXpConfig(guild)); // 0 XP
  const xp = coupleXpToRank(guild, 'u12', LADDER, 'r-veteran', 'promote');
  assert.equal(xp, T[2]);
  assert.equal(getUserXp(guild, 'u12'), T[2]);
});

test('coupleXpToRank: a hand demotion caps XP so auto-sync cannot undo it', () => {
  const guild = pinnedGuildId();
  const config = getXpConfig(guild);
  ensureSeeded(guild, fakeMember('u13', ['r-legend']), LADDER, config); // seeded at Legend floor
  const xp = coupleXpToRank(guild, 'u13', LADDER, 'r-regular', 'demote');
  assert.equal(xp, T[1], 'capped at the Regular floor');
  // The promote-only sync now agrees with the demotion instead of reverting it.
  const member = withGuildId(fakeMember('u13', ['r-regular']), guild);
  return syncMemberRank(member, LADDER, getUserXp(guild, 'u13'), config).then((sync) => {
    assert.equal(sync.changed, false, 'no instant re-promotion after a human demotion');
  });
});

test('coupleXpToRank is a no-op on an unpinned ladder or unknown role', () => {
  const unpinned = freshGuildId();
  assert.equal(coupleXpToRank(unpinned, 'x', HEURISTIC_LADDER, 'r-rookie', 'promote'), null);
  const guild = pinnedGuildId();
  assert.equal(coupleXpToRank(guild, 'x', LADDER, 'not-a-rank', 'promote'), null);
  assert.deepEqual(getUsers(unpinned), {}, 'nothing written');
});
