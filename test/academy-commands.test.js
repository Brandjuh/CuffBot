import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import promote from '../src/modules/academy/commands/promote.js';
import demote from '../src/modules/academy/commands/demote.js';
import ranks from '../src/modules/academy/commands/ranks.js';
import rankSetup from '../src/modules/academy/commands/rank-setup.js';
import rankExclude from '../src/modules/academy/commands/rank-exclude.js';
import { getGuildData } from '../src/core/store.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-academy-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';
const MANAGE_ROLES = PermissionFlagsBits.ManageRoles;
const MANAGE_GUILD = PermissionFlagsBits.ManageGuild;

// Guild roles: header + 4 ranks high→low, all editable by the bot.
function roleCache(editable = true) {
  const cache = new Map();
  cache.set('lvl-header', { id: 'lvl-header', name: '▬ LEVELER ▬', position: 80, editable });
  [
    ['r-legend', 'Legend', 79],
    ['r-veteran', 'Veteran', 78],
    ['r-regular', 'Regular', 77],
    ['r-rookie', 'Rookie', 76],
  ].forEach(([id, name, position]) => cache.set(id, { id, name, position, editable }));
  return cache;
}

function fakeInteraction({ perms = [], target, memberRoleIds = [], toRole = null, headerRole = null, role = null, action = null, editable = true, botCanManage = true }) {
  const replies = [];
  const added = [];
  const removed = [];
  const cache = roleCache(editable);
  const memberRoles = new Map(memberRoleIds.map((id) => [id, cache.get(id)]));
  const member = {
    roles: {
      cache: memberRoles,
      add: async (ids) => added.push(...[].concat(ids)),
      remove: async (ids) => removed.push(...[].concat(ids)),
    },
  };
  return {
    replies,
    added,
    removed,
    user: { id: '1', username: 'sarge', displayName: 'sarge', toString: () => '<@1>' },
    memberPermissions: { has: (f) => perms.includes(f) },
    guild: {
      id: GUILD,
      roles: { cache },
      members: {
        me: { permissions: { has: () => botCanManage } },
        fetch: async () => (target ? member : null),
      },
    },
    options: {
      getUser: () => target,
      getRole: (n) => (n === 'to' ? toRole : n === 'header' ? headerRole : n === 'role' ? role : null),
      getString: (n) => (n === 'action' ? action : null),
    },
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

const TARGET = { id: '2', username: 'rookie', displayName: 'rookie', toString: () => '<@2>' };

// Configure the ladder for the guild once (header + no exclusions).
function configure() {
  const ix = fakeInteraction({ perms: [MANAGE_GUILD], headerRole: { id: 'lvl-header' } });
  return rankSetup.execute(ix).then(() => ix);
}

test('rank-setup requires Manage Server and stores the header', async () => {
  const denied = fakeInteraction({ perms: [], headerRole: { id: 'lvl-header' } });
  await rankSetup.execute(denied);
  assert.match(denied.replies[0].content, /Manage Server/);

  await configure();
  assert.equal(getGuildData(GUILD, 'academyConfig', {}).headerRoleId, 'lvl-header');
});

test('ranks shows the detected ladder highest-first', async () => {
  await configure();
  const ix = fakeInteraction({ perms: [] });
  await ranks.execute(ix);
  const desc = ix.replies[0].embeds[0].data?.description ?? ix.replies[0].embeds[0].description;
  assert.match(desc, /r-legend/);
  assert.match(desc, /r-rookie/);
});

test('promote inducts a rankless member at the lowest rank', async () => {
  await configure();
  const ix = fakeInteraction({ perms: [MANAGE_ROLES], target: TARGET, memberRoleIds: [] });
  await promote.execute(ix);
  assert.deepEqual(ix.added, ['r-rookie']);
  assert.match(ix.replies[0].content, /inducted at \*\*Rookie\*\*/);
});

test('promote moves one rung up and swaps the rank role', async () => {
  await configure();
  const ix = fakeInteraction({ perms: [MANAGE_ROLES], target: TARGET, memberRoleIds: ['r-regular'] });
  await promote.execute(ix);
  assert.deepEqual(ix.added, ['r-veteran']);
  assert.deepEqual(ix.removed, ['r-regular']);
  assert.match(ix.replies[0].content, /Regular\*\* → \*\*Veteran/);
});

test('promote is blocked when the target rank role is above the bot', async () => {
  await configure();
  const ix = fakeInteraction({ perms: [MANAGE_ROLES], target: TARGET, memberRoleIds: [], editable: false });
  await promote.execute(ix);
  assert.equal(ix.added.length, 0);
  assert.match(ix.replies[0].content, /highest role/i);
});

test('promote is blocked when the bot itself lacks Manage Roles', async () => {
  await configure();
  const ix = fakeInteraction({ perms: [MANAGE_ROLES], target: TARGET, memberRoleIds: [], botCanManage: false });
  await promote.execute(ix);
  assert.equal(ix.added.length, 0);
  assert.match(ix.replies[0].content, /grant CuffBot the \*\*Manage Roles\*\*/);
});

test('demote busts a member down one rung', async () => {
  await configure();
  const ix = fakeInteraction({ perms: [MANAGE_ROLES], target: TARGET, memberRoleIds: ['r-veteran'] });
  await demote.execute(ix);
  assert.deepEqual(ix.added, ['r-regular']);
  assert.deepEqual(ix.removed, ['r-veteran']);
  assert.match(ix.replies[0].content, /busted down/i);
});

test('demote refuses when there is no rank to remove', async () => {
  await configure();
  const ix = fakeInteraction({ perms: [MANAGE_ROLES], target: TARGET, memberRoleIds: [] });
  await demote.execute(ix);
  assert.equal(ix.added.length, 0);
  assert.match(ix.replies[0].content, /nothing to demote/i);
});

test('rank-exclude adds a role to the exclusion list', async () => {
  await configure();
  const ix = fakeInteraction({ perms: [MANAGE_GUILD], role: { id: 'r-rookie', toString: () => '<@&r-rookie>' }, action: 'add' });
  await rankExclude.execute(ix);
  assert.ok(getGuildData(GUILD, 'academyConfig', {}).excludedRoleIds.includes('r-rookie'));
  // now the ladder should drop Rookie
  const rk = fakeInteraction({ perms: [] });
  await ranks.execute(rk);
  const desc = rk.replies[0].embeds[0].data?.description ?? rk.replies[0].embeds[0].description;
  assert.ok(!/r-rookie/.test(desc), 'excluded role no longer in the ladder');
});
