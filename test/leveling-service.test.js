import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  awardMessageXp,
  awardVoiceMinute,
  ensureSeeded,
  getUserXp,
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

const LADDER = {
  ranks: [
    { roleId: 'r-legend', name: 'Legend' },
    { roleId: 'r-veteran', name: 'Veteran' },
    { roleId: 'r-regular', name: 'Regular' },
    { roleId: 'r-rookie', name: 'Rookie' },
  ],
};
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
  const guild = freshGuildId();
  const config = getXpConfig(guild);
  assert.equal(config.enabled, true);
  assert.equal(config.syncRoles, true);
  setXpConfig(guild, { messageXp: 20, enabled: false });
  const next = getXpConfig(guild);
  assert.equal(next.messageXp, 20);
  assert.equal(next.enabled, false);
  assert.equal(next.voiceXpPerMin, 10, 'unpatched keys keep defaults');
});

test('first sight of a ranked member seeds XP from the rank they hold', () => {
  const guild = freshGuildId();
  const config = getXpConfig(guild);
  const member = fakeMember('u1', ['r-veteran']); // 2nd from top on a 4-rank ladder
  const record = ensureSeeded(guild, member, LADDER, config);
  assert.equal(record.xp, T[2], 'Veteran = 3rd from bottom → thresholds[2]');
  assert.equal(record.seededFromRank, 'Veteran');
  assert.equal(getUserXp(guild, 'u1'), T[2]);
});

test('first sight of a rankless member seeds 0 (new members start at 0)', () => {
  const guild = freshGuildId();
  const member = fakeMember('u2', []);
  const record = ensureSeeded(guild, member, LADDER, getXpConfig(guild));
  assert.equal(record.xp, 0);
  assert.equal(record.seededFromRank, null);
});

test('ensureSeeded never re-seeds or overwrites an existing record', () => {
  const guild = freshGuildId();
  const config = getXpConfig(guild);
  ensureSeeded(guild, fakeMember('u3', []), LADDER, config);
  awardMessageXp(guild, fakeMember('u3', []), LADDER, config, 1_000_000);
  const xpAfterMessage = getUserXp(guild, 'u3');
  // Member later gains a rank role by hand — seeding must not fire again.
  const again = ensureSeeded(guild, fakeMember('u3', ['r-legend']), LADDER, config);
  assert.equal(again.xp, xpAfterMessage, 'existing record untouched');
});

test('awardMessageXp seeds on first sight, then adds message XP on top', () => {
  const guild = freshGuildId();
  const config = getXpConfig(guild);
  const out = awardMessageXp(guild, fakeMember('u4', ['r-rookie']), LADDER, config, 1_000_000);
  assert.equal(out.seeded, true);
  assert.equal(out.gained, config.messageXp);
  assert.equal(out.xp, T[0] + config.messageXp, 'seeded floor + first message');
});

test('awardMessageXp honors the cooldown', () => {
  const guild = freshGuildId();
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
  const guild = freshGuildId();
  const config = getXpConfig(guild);
  const member = fakeMember('u6', []);
  awardVoiceMinute(guild, member, LADDER, config);
  awardVoiceMinute(guild, member, LADDER, config);
  assert.equal(getUserXp(guild, 'u6'), config.voiceXpPerMin * 2);
});

test('leaderboard sorts by XP, highest first, and respects the limit', () => {
  const guild = freshGuildId();
  const config = getXpConfig(guild);
  awardVoiceMinute(guild, fakeMember('low', []), LADDER, config);
  ensureSeeded(guild, fakeMember('high', ['r-legend']), LADDER, config);
  ensureSeeded(guild, fakeMember('mid', ['r-rookie']), LADDER, config);
  const rows = leaderboard(guild, 2);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => r.userId), ['high', 'mid']);
});

test('syncMemberRank promotes when XP earns a higher rank', async () => {
  const guild = freshGuildId();
  const config = getXpConfig(guild);
  const member = fakeMember('u7', ['r-rookie']);
  const sync = await syncMemberRank(member, LADDER, T[1], config); // earns Regular
  assert.equal(sync.changed, true);
  assert.equal(sync.from, 'Rookie');
  assert.equal(sync.to, 'Regular');
  assert.deepEqual(member.added, ['r-regular']);
  assert.deepEqual(member.removed, ['r-rookie']);
});

test('syncMemberRank never demotes a member holding a higher rank', async () => {
  const guild = freshGuildId();
  const member = fakeMember('u8', ['r-legend']);
  const sync = await syncMemberRank(member, LADDER, T[0], getXpConfig(guild)); // XP only earns Rookie
  assert.equal(sync.changed, false);
  assert.equal(member.added.length, 0);
  assert.equal(member.removed.length, 0);
});

test('syncMemberRank respects the syncRoles=false switch', async () => {
  const guild = freshGuildId();
  setXpConfig(guild, { syncRoles: false });
  const member = fakeMember('u9', []);
  const sync = await syncMemberRank(member, LADDER, T[3], getXpConfig(guild));
  assert.equal(sync.changed, false);
  assert.equal(member.added.length, 0);
});

test('syncMemberRank reports blocked when the role sits above the bot', async () => {
  const guild = freshGuildId();
  const member = fakeMember('u10', [], { editable: false });
  const sync = await syncMemberRank(member, LADDER, T[0], getXpConfig(guild));
  assert.equal(sync.changed, false);
  assert.equal(sync.blocked, true);
  assert.equal(member.added.length, 0);
});
