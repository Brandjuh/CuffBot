import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import promote from '../src/modules/academy/commands/promote.js';
import demote from '../src/modules/academy/commands/demote.js';
import ranks from '../src/modules/academy/commands/ranks.js';

// S106: `!rank-setup` and `!rank-exclude` are subcommands of `!ranks` now.
const SETUP_SUB = ranks.group.subcommands.find((s) => s.name === 'setup');
const EXCLUDE_SUB = ranks.group.subcommands.find((s) => s.name === 'exclude');
const LIST_SUB = ranks.group.subcommands.find((s) => s.name === 'list');
import { getGuildData } from '../src/core/store.js';
import { dispatchCommand } from '../src/core/prefix/command.js';
import { dispatchGroup } from '../src/core/prefix/group.js';
import { fakeMessage } from './fixtures/fake-message.js';

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

/**
 * S94: the academy commands are flat `{ command }` commands now, so these
 * drive `run(ctx, values)` with the rich role fixture above — fakeMessage's
 * plain guild cannot stand in for it, and the framework's own gate/arg layer
 * is covered by test/prefix-command.test.js. One dispatch-level test at the
 * bottom covers what actually changed for the owner: `header:@role`.
 */
function fakeCtx({ target, memberRoleIds = [], editable = true, botCanManage = true }) {
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
    // The resolved arg values this ctx's command should receive.
    values: target ? { target } : {},
    prefix: '!',
    user: { id: '1', username: 'sarge', displayName: 'sarge', toString: () => '<@1>' },
    guild: {
      id: GUILD,
      roles: { cache },
      members: {
        me: { permissions: { has: () => botCanManage } },
        fetch: async () => {
          if (!target) throw new Error('unknown member');
          return member;
        },
      },
    },
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

const TARGET = { id: '2', username: 'rookie', displayName: 'rookie', toString: () => '<@2>' };
const EXCLUDED = { id: 'r-rookie', toString: () => '<@&r-rookie>' };

// Configure the ladder for the guild once (header + no exclusions).
function configure() {
  const ctx = fakeCtx({});
  return SETUP_SUB.run(ctx, { header: { id: 'lvl-header' } }).then(() => ctx);
}

test('rank-setup requires Manage Server and stores the header', async () => {
  const denied = fakeMessage({ perms: false, guildId: GUILD });
  const outcome = await dispatchGroup(ranks.group, denied, ['setup', ...[]], '!');
  assert.equal(outcome, 'refused');
  assert.match(denied.sent[0].content, /Manage Server/);

  await configure();
  assert.equal(getGuildData(GUILD, 'academyConfig', {}).headerRoleId, 'lvl-header');
});

test('ranks shows the detected ladder highest-first', async () => {
  await configure();
  const ix = fakeCtx({});
  await LIST_SUB.run(ix, ix.values ?? {});
  const desc = ix.replies[0].embeds[0].data?.description ?? ix.replies[0].embeds[0].description;
  assert.match(desc, /r-legend/);
  assert.match(desc, /r-rookie/);
});

test('promote inducts a rankless member at the lowest rank', async () => {
  await configure();
  const ix = fakeCtx({ target: TARGET, memberRoleIds: [] });
  await promote.command.run(ix, ix.values ?? {});
  assert.deepEqual(ix.added, ['r-rookie']);
  assert.match(ix.replies[0].content, /inducted at \*\*Rookie\*\*/);
});

test('promote moves one rung up and swaps the rank role', async () => {
  await configure();
  const ix = fakeCtx({ target: TARGET, memberRoleIds: ['r-regular'] });
  await promote.command.run(ix, ix.values ?? {});
  assert.deepEqual(ix.added, ['r-veteran']);
  assert.deepEqual(ix.removed, ['r-regular']);
  assert.match(ix.replies[0].content, /Regular\*\* → \*\*Veteran/);
});

test('promote is blocked when the target rank role is above the bot', async () => {
  await configure();
  const ix = fakeCtx({ target: TARGET, memberRoleIds: [], editable: false });
  await promote.command.run(ix, ix.values ?? {});
  assert.equal(ix.added.length, 0);
  assert.match(ix.replies[0].content, /highest role/i);
});

test('promote is blocked when the bot itself lacks Manage Roles', async () => {
  await configure();
  const ix = fakeCtx({ target: TARGET, memberRoleIds: [], botCanManage: false });
  await promote.command.run(ix, ix.values ?? {});
  assert.equal(ix.added.length, 0);
  assert.match(ix.replies[0].content, /grant CuffBot the \*\*Manage Roles\*\*/);
});

test('demote busts a member down one rung', async () => {
  await configure();
  const ix = fakeCtx({ target: TARGET, memberRoleIds: ['r-veteran'] });
  await demote.command.run(ix, ix.values ?? {});
  assert.deepEqual(ix.added, ['r-regular']);
  assert.deepEqual(ix.removed, ['r-veteran']);
  assert.match(ix.replies[0].content, /busted down/i);
});

test('demote refuses when there is no rank to remove', async () => {
  await configure();
  const ix = fakeCtx({ target: TARGET, memberRoleIds: [] });
  await demote.command.run(ix, ix.values ?? {});
  assert.equal(ix.added.length, 0);
  assert.match(ix.replies[0].content, /nothing to demote/i);
});

test('rank-exclude adds a role to the exclusion list', async () => {
  await configure();
  const ix = fakeCtx({});
  await EXCLUDE_SUB.run(ix, { role: EXCLUDED, action: 'add' });
  assert.ok(getGuildData(GUILD, 'academyConfig', {}).excludedRoleIds.includes('r-rookie'));
  // now the ladder should drop Rookie
  const rk = fakeCtx({});
  await LIST_SUB.run(rk, {});
  const desc = rk.replies[0].embeds[0].data?.description ?? rk.replies[0].embeds[0].description;
  assert.ok(!/r-rookie/.test(desc), 'excluded role no longer in the ladder');
});

test('promote couples XP up to the new rank floor (leveling seam, S16)', async () => {
  await configure();
  const { setGuildData } = await import('../src/core/store.js');
  setGuildData(GUILD, 'academyConfig', { headerRoleId: 'lvl-header', excludedRoleIds: [] });
  const { getUserXp } = await import('../src/modules/leveling/service.js');
  const { thresholdsFor } = await import('../src/modules/leveling/lib/xp.js');
  const target = { id: '77', username: 'lift', displayName: 'lift', toString: () => '<@77>' };
  const ix = fakeCtx({ target, memberRoleIds: ['r-regular'] });
  await promote.command.run(ix, ix.values ?? {}); // Regular → Veteran
  const t = thresholdsFor(4, {});
  assert.equal(getUserXp(GUILD, '77'), t[2], 'XP raised to the Veteran floor');
});

test('demote caps XP at the new rank floor so auto-sync cannot undo it (S16)', async () => {
  await configure();
  const { setGuildData } = await import('../src/core/store.js');
  setGuildData(GUILD, 'academyConfig', { headerRoleId: 'lvl-header', excludedRoleIds: [] });
  const { getUserXp } = await import('../src/modules/leveling/service.js');
  const { thresholdsFor } = await import('../src/modules/leveling/lib/xp.js');
  const target = { id: '78', username: 'bust', displayName: 'bust', toString: () => '<@78>' };
  // First hand-promote to Veteran (XP coupled to its floor)…
  const up = fakeCtx({ target, memberRoleIds: ['r-regular'] });
  await promote.command.run(up, up.values);
  // …then demote back down: XP must drop to the Regular floor.
  const down = fakeCtx({ target, memberRoleIds: ['r-veteran'] });
  await demote.command.run(down, down.values);
  const t = thresholdsFor(4, {});
  assert.equal(getUserXp(GUILD, '78'), t[1], 'XP capped at the Regular floor');
});

// ── the owner's documented invocation (S94) ─────────────────────────────────
// `!rank-setup header:@[LEVELER]` is printed in STATE's owner-action list, in
// the academy and leveling manuals, and in the bot's own `!ranks`,
// `!xp-ladder` and `!level` replies. On the text path it had NEVER worked: the
// legacy adapter was purely positional, so the token `header:<@&…>` came back
// as "`header` should be a mention or id" (S68 → S94).

test('rank-setup accepts the documented header: form — and the bare mention', async () => {
  const HEADER = '701577807070756946';
  for (const tokens of [[`header:<@&${HEADER}>`], [`<@&${HEADER}>`], [`header:${HEADER}`]]) {
    const guildId = `9411000000000${String(tokens.length + tokens[0].length).padStart(5, '0')}`;
    const message = fakeMessage({
      guildId,
      roles: { [HEADER]: { id: HEADER, name: '▬ LEVELER ▬', position: 80 } },
    });
    message.guild.members = { me: { permissions: { has: () => true } } };
    const outcome = await dispatchGroup(ranks.group, message, ['setup', ...tokens], '!');
    assert.equal(outcome, 'ran', `"${tokens.join(' ')}" should run`);
    assert.equal(
      getGuildData(guildId, 'academyConfig', {}).headerRoleId,
      HEADER,
      `"${tokens.join(' ')}" should pin the header`,
    );
  }
});

test('rank-exclude takes action: as a keyword or positionally', async () => {
  const ROLE = '701577807070756947';
  for (const tokens of [[`<@&${ROLE}>`, 'action:remove'], [`<@&${ROLE}>`, 'remove']]) {
    const message = fakeMessage({
      guildId: GUILD,
      roles: { [ROLE]: { id: ROLE, name: 'Cosmetic', position: 5 } },
    });
    await dispatchGroup(ranks.group, message, ['exclude', ...tokens], '!');
    // Nothing was excluded yet, so "remove" reports the miss — which proves the
    // action reached run() as `remove` rather than defaulting to `add`.
    assert.match(message.sent[0].content, /was not on the exclusion list/);
  }
});

test('rank-exclude refuses an action that is not add or remove', async () => {
  const ROLE = '701577807070756948';
  const message = fakeMessage({
    guildId: GUILD,
    roles: { [ROLE]: { id: ROLE, name: 'Cosmetic', position: 5 } },
  });
  const outcome = await dispatchGroup(ranks.group, message, ['exclude', ...[`<@&${ROLE}>`, 'action:banish']], '!');
  assert.equal(outcome, 'usage-error');
  assert.match(message.sent[0].content, /`action` must be one of: add, remove/);
});
