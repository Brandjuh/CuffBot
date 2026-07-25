import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  MAX_SELF_ROLES,
  buttonLabel,
  isSelfRolesHeader,
  renderSelfRolesLines,
  selectSelfRoles,
} from '../src/modules/selfroles/lib/selfroles.js';
import {
  BUTTON_PREFIX,
  DEFAULT_SELFROLES_CONFIG,
  buildSelfRolesPayloads,
  clearRoleInfo,
  getSelfrolesInfo,
  refreshSelfRoles,
  setRoleInfo,
  setSelfrolesConfig,
  toggleSelfRole,
} from '../src/modules/selfroles/service.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-selfroles-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `70000000000000${String((seq += 1)).padStart(4, '0')}`;

// ── pure section logic ───────────────────────────────────────────────────────

test('isSelfRolesHeader matches decorated variants, case-insensitively', () => {
  assert.equal(isSelfRolesHeader('self-roles'), true);
  assert.equal(isSelfRolesHeader('  Self-Roles  '), true);
  assert.equal(isSelfRolesHeader('── self-roles ──'), true);
  assert.equal(isSelfRolesHeader('roles'), false);
  assert.equal(isSelfRolesHeader('self-roles-info'), false);
});

test('selectSelfRoles takes the section under the header, stops at the next divider', () => {
  const roles = [
    { id: 'mod', name: 'Moderator' },
    { id: 'hdr', name: 'self-roles' },
    { id: 'a', name: 'Announcements' },
    { id: 'bot', name: 'Some Bot', managed: true },
    { id: 'b', name: 'Movie Night' },
    { id: 'danger', name: 'Secret Mod', elevated: true },
    { id: 'div', name: '───────' },
    { id: 'c', name: 'Below Divider' },
    { id: 'ev', name: '@everyone' },
  ];
  const result = selectSelfRoles(roles);
  assert.equal(result.headerFound, true);
  assert.equal(result.headerRoleId, 'hdr');
  assert.deepEqual(result.roles.map((r) => r.id), ['a', 'b'], 'divider ends the section');
  assert.deepEqual(
    result.skipped.map((r) => `${r.id}:${r.reason}`),
    ['bot:managed by an integration', 'danger:has elevated permissions'],
  );
  assert.equal(selectSelfRoles([{ id: 'x', name: 'No Header Here' }]).headerFound, false);
});

test('selectSelfRoles caps at the 125-role sanity cap and reports the overflow (S64)', () => {
  const roles = [
    { id: 'hdr', name: 'self-roles' },
    ...Array.from({ length: 130 }, (_, i) => ({ id: `r${i}`, name: `Role ${i}` })),
  ];
  const result = selectSelfRoles(roles);
  assert.equal(MAX_SELF_ROLES, 125, 'S64: five messages of 25 buttons');
  assert.equal(result.roles.length, MAX_SELF_ROLES);
  assert.equal(result.skipped.length, 5);
  assert.match(result.skipped[0].reason, /125-role cap/);
});

test('renderSelfRolesLines shows configured emoji and info text', () => {
  const lines = renderSelfRolesLines(
    [{ id: 'a', name: 'Movie Night' }, { id: 'b', name: 'Plain' }],
    { a: { emoji: '🎬', text: 'Pinged for movie evenings' } },
  );
  assert.equal(lines[0], '🎬 **Movie Night** — Pinged for movie evenings');
  assert.equal(lines[1], '**Plain**');
});

test('buttonLabel clamps to Discord’s 80-char limit', () => {
  assert.equal(buttonLabel('Movie Night'), 'Movie Night');
  assert.equal(buttonLabel(''), 'role');
  assert.equal(buttonLabel('x'.repeat(100)).length, 80);
});

// ── service on a fake guild ──────────────────────────────────────────────────

test('the owner channel is the committed default (S59)', () => {
  assert.equal(DEFAULT_SELFROLES_CONFIG.channelId, '625276074833608705');
  assert.equal(DEFAULT_SELFROLES_CONFIG.headerName, 'self-roles');
  assert.equal(DEFAULT_SELFROLES_CONFIG.enabled, true);
});

function fakeRole(id, name, { managed = false, elevated = false, position = 0 } = {}) {
  return { id, name, managed, position, permissions: { any: () => elevated } };
}

function fakeSelfrolesGuild(guildId, roles, { channelId = 'sr-chan' } = {}) {
  const sends = [];
  const store = new Map(); // messageId → message
  let msgSeq = 0;
  const channel = {
    id: channelId,
    send: async (payload) => {
      msgSeq += 1;
      const message = { id: `m${msgSeq}`, payload, edits: [], edit: async (p) => (message.edits.push(p), message) };
      store.set(message.id, message);
      sends.push(message);
      return message;
    },
    messages: {
      fetch: async (id) => {
        const m = store.get(id);
        if (!m) throw new Error('Unknown Message');
        return m;
      },
      delete: (id) => store.delete(id),
    },
  };
  return {
    id: guildId,
    roles: { cache: new Map(roles.map((r) => [r.id, r])) },
    channels: { cache: new Map([[channelId, channel]]) },
    sends,
    channel,
    messageStore: store,
  };
}

const SECTION = [
  fakeRole('hdr', 'self-roles', { position: 10 }),
  fakeRole('news', 'News Ping', { position: 9 }),
  fakeRole('movie', 'Movie Night', { position: 8 }),
];

test('refreshSelfRoles posts once, then edits the same tracked message (S59)', async () => {
  const guildId = freshGuildId();
  const guild = fakeSelfrolesGuild(guildId, SECTION);
  setSelfrolesConfig(guildId, { channelId: 'sr-chan' });
  setRoleInfo(guildId, 'movie', { text: 'Pinged for movie evenings', emoji: '🎬' });

  assert.equal(await refreshSelfRoles(guild), 'posted');
  const posted = guild.sends[0];
  const description = posted.payload.embeds[0].data.description;
  assert.match(description, /🎬 \*\*Movie Night\*\* — Pinged for movie evenings/);
  assert.match(description, /\*\*News Ping\*\*/);
  const buttons = posted.payload.components[0].components.map((b) => b.data);
  assert.deepEqual(
    buttons.map((b) => b.custom_id),
    [`${BUTTON_PREFIX}news`, `${BUTTON_PREFIX}movie`],
  );

  // Second refresh edits in place — same message, no second post.
  assert.equal(await refreshSelfRoles(guild), 'edited');
  assert.equal(guild.sends.length, 1);
  assert.equal(posted.edits.length, 1);

  // Deleted message → reposted and re-tracked (the bot can always adjust its list).
  guild.messageStore.delete(posted.id);
  assert.equal(await refreshSelfRoles(guild), 'posted');
  assert.equal(guild.sends.length, 2);
});

test('refreshSelfRoles reports missing header/channel and the disabled switch', async () => {
  const guildId = freshGuildId();
  const noHeader = fakeSelfrolesGuild(guildId, [fakeRole('x', 'Just A Role')]);
  setSelfrolesConfig(guildId, { channelId: 'sr-chan' });
  assert.equal(await refreshSelfRoles(noHeader), 'no-header');

  const gone = fakeSelfrolesGuild(guildId, SECTION, { channelId: 'other' });
  assert.equal(await refreshSelfRoles(gone), 'missing-channel', 'configured channel absent');

  setSelfrolesConfig(guildId, { enabled: false });
  assert.equal(await refreshSelfRoles(fakeSelfrolesGuild(guildId, SECTION)), 'disabled');
  setSelfrolesConfig(guildId, { enabled: true });
});

function fakeMember(id, heldIds = []) {
  const held = new Set(heldIds);
  return {
    id,
    held,
    roles: {
      cache: { has: (r) => held.has(r) },
      add: async (r) => held.add(r),
      remove: async (r) => held.delete(r),
    },
  };
}

test('toggleSelfRole: press = get it, press again = lose it; outsiders refused (S59)', async () => {
  const guildId = freshGuildId();
  const guild = fakeSelfrolesGuild(guildId, SECTION);
  setSelfrolesConfig(guildId, { channelId: 'sr-chan' });
  const member = fakeMember('lid');

  const on = await toggleSelfRole(guild, member, 'movie');
  assert.deepEqual(on, { code: 'added', roleName: 'Movie Night' });
  assert.ok(member.held.has('movie'));

  const off = await toggleSelfRole(guild, member, 'movie');
  assert.deepEqual(off, { code: 'removed', roleName: 'Movie Night' });
  assert.ok(!member.held.has('movie'));

  assert.equal((await toggleSelfRole(guild, member, 'hdr')).code, 'not-selfrole', 'the header itself is not a prize');
  assert.equal((await toggleSelfRole(guild, member, 'ghost')).code, 'not-selfrole');
});

test('toggleSelfRole reports a blocked role write honestly', async () => {
  const guildId = freshGuildId();
  const guild = fakeSelfrolesGuild(guildId, SECTION);
  setSelfrolesConfig(guildId, { channelId: 'sr-chan' });
  const member = fakeMember('lid');
  member.roles.add = async () => {
    throw new Error('Missing Permissions');
  };
  assert.equal((await toggleSelfRole(guild, member, 'news')).code, 'failed');
});

test('role info round-trips and clears', () => {
  const guildId = freshGuildId();
  setRoleInfo(guildId, 'r1', { text: 'hello' });
  setRoleInfo(guildId, 'r1', { emoji: '🎉' });
  assert.deepEqual(getSelfrolesInfo(guildId).r1, { text: 'hello', emoji: '🎉' }, 'partial updates merge');
  assert.equal(clearRoleInfo(guildId, 'r1'), true);
  assert.equal(clearRoleInfo(guildId, 'r1'), false);
  assert.deepEqual(getSelfrolesInfo(guildId), {});
});

test('buildSelfRolesPayloads chunks into messages of ≤25 buttons (S64)', () => {
  const guildId = freshGuildId();
  const many = [
    fakeRole('hdr', 'self-roles', { position: 100 }),
    ...Array.from({ length: 33 }, (_, i) => fakeRole(`r${i}`, `Role ${i}`, { position: 90 - i })),
  ];
  const guild = fakeSelfrolesGuild(guildId, many);
  setSelfrolesConfig(guildId, { channelId: 'sr-chan' });
  const { payloads } = buildSelfRolesPayloads(guild);
  assert.equal(payloads.length, 2, '33 roles → 25 + 8');
  assert.equal(payloads[0].components.length, 5, 'first message: full 5 rows');
  for (const row of payloads[0].components) assert.ok(row.components.length <= 5);
  assert.equal(payloads[1].components.reduce((n, row) => n + row.components.length, 0), 8);
  assert.match(payloads[1].embeds[0].data.title, /continued/);
});

test('refreshSelfRoles maintains a multi-message list: edit, extend, shrink (S64)', async () => {
  const guildId = freshGuildId();
  const many = [
    fakeRole('hdr', 'self-roles', { position: 100 }),
    ...Array.from({ length: 30 }, (_, i) => fakeRole(`r${i}`, `Role ${i}`, { position: 90 - i })),
  ];
  const guild = fakeSelfrolesGuild(guildId, many);
  setSelfrolesConfig(guildId, { channelId: 'sr-chan' });

  assert.equal(await refreshSelfRoles(guild), 'posted');
  assert.equal(guild.sends.length, 2, '30 roles → two messages');

  // Unchanged roster → both messages edit in place.
  assert.equal(await refreshSelfRoles(guild), 'edited');
  assert.equal(guild.sends.length, 2);
  assert.equal(guild.sends[0].edits.length, 1);
  assert.equal(guild.sends[1].edits.length, 1);

  // Roster shrinks under 25 → the surplus second message is deleted.
  for (let i = 10; i < 30; i += 1) guild.roles.cache.delete(`r${i}`);
  assert.equal(await refreshSelfRoles(guild), 'edited');
  assert.equal(guild.messageStore.has(guild.sends[1].id), false, 'surplus message removed');
  assert.equal(guild.messageStore.has(guild.sends[0].id), true);
});

test('a legacy single-message record (pre-S64 shape) still edits in place', async () => {
  const { setGuildData } = await import('../src/core/store.js');
  const { SELFROLES_MESSAGE_KEY } = await import('../src/modules/selfroles/service.js');
  const guildId = freshGuildId();
  const guild = fakeSelfrolesGuild(guildId, SECTION);
  setSelfrolesConfig(guildId, { channelId: 'sr-chan' });

  await refreshSelfRoles(guild); // creates m1
  // Rewrite the store into the OLD shape: { channelId, messageId }.
  setGuildData(guildId, SELFROLES_MESSAGE_KEY, { channelId: 'sr-chan', messageId: guild.sends[0].id });
  assert.equal(await refreshSelfRoles(guild), 'edited', 'legacy record recognized');
  assert.equal(guild.sends.length, 1, 'no duplicate post');
});
