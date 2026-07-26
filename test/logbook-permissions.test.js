// S113: permission-change logging (owner: "Er zijn wat permissies veranderd
// echter zijn deze niet gelogd, plaats dit soort logs in 494216580545380372").
//
// Every expected permission NAME below is typed out as a literal rather than
// derived from `PermissionsBitField.Flags`. Reading the names back off the
// same table the code reads them from would compare the table with itself and
// pass no matter what the diffing does (S111 / skill rule 0.5.35).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeOverwrite,
  diffOverwrites,
  diffPermissions,
  overwriteSnapshot,
  permissionNames,
} from '../src/modules/logbook/lib/permissions.js';
import { channelPermissionsChanged, rolePermissionsChanged } from '../src/modules/logbook/lib/logformat.js';
// Static, never `await import()` inside a test: the Pi's older node:test
// runner mis-sequences tests registered after an await (S78 / skill 0.5.18).
import { onChannelUpdate, onRoleUpdate } from '../src/modules/logbook/events/server.js';

// Discord's documented bit values, written out here on purpose.
const ADMINISTRATOR = 8n;
const KICK_MEMBERS = 2n;
const BAN_MEMBERS = 4n;
const VIEW_CHANNEL = 1024n;
const SEND_MESSAGES = 2048n;

test('permission names are spaced, not CamelCase identifiers', () => {
  assert.deepEqual(permissionNames(ADMINISTRATOR), ['Administrator']);
  assert.deepEqual(permissionNames(KICK_MEMBERS), ['Kick Members']);
  assert.deepEqual(permissionNames(VIEW_CHANNEL), ['View Channel']);
});

test('an empty bitfield names nothing', () => {
  assert.deepEqual(permissionNames(0n), []);
  assert.deepEqual(permissionNames(undefined), []);
});

test('a bit no flag in this discord.js knows about is dropped, not printed raw', () => {
  // Bit 63 is not a real permission today. A future Discord permission must
  // not turn a log line into a hexadecimal dump.
  const names = permissionNames(1n << 62n);
  assert.deepEqual(names, []);
});

test('diffPermissions reports both directions independently', () => {
  const before = KICK_MEMBERS | BAN_MEMBERS;
  const after = KICK_MEMBERS | ADMINISTRATOR;
  const diff = diffPermissions(before, after);
  assert.deepEqual(diff.added, ['Administrator']);
  assert.deepEqual(diff.removed, ['Ban Members']);
  assert.equal(diff.changed, true);
});

test('an unchanged bitfield is not a change', () => {
  const diff = diffPermissions(VIEW_CHANNEL, VIEW_CHANNEL);
  assert.equal(diff.changed, false);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.removed, []);
});

test('granting Administrator is called out on its own line, and reddens the entry', () => {
  const entry = rolePermissionsChanged({
    roleId: '1',
    name: 'Moderators',
    added: ['Administrator', 'Kick Members'],
    removed: [],
  });
  assert.equal(entry.icon, '🚨');
  const body = entry.lines.join('\n');
  assert.match(body, /Administrator — it can do everything/);
  // It must ALSO appear in the granted list — the callout is an addition to
  // the record, not a replacement for it.
  assert.match(body, /\*\*Granted:\*\*.*Administrator/);
});

test('an ordinary grant gets the plain shield, not the alarm', () => {
  const entry = rolePermissionsChanged({ roleId: '1', name: 'Cadets', added: ['Send Messages'], removed: [] });
  assert.equal(entry.icon, '🛡️');
  assert.equal(entry.category, 'server');
});

test('a revoke-only change still renders', () => {
  const entry = rolePermissionsChanged({ roleId: '9', name: 'Trainees', added: [], removed: ['Ban Members'] });
  const body = entry.lines.join('\n');
  assert.match(body, /\*\*Revoked:\*\* Ban Members/);
  assert.doesNotMatch(body, /Granted/);
});

// ── channel overwrites ───────────────────────────────────────────────────────

const ow = (id, allow, deny, type = 0) => ({ id, type, allow, deny });

test('a new overwrite is diffed against nothing, so everything it holds is reported', () => {
  const changes = diffOverwrites([], [ow('42', VIEW_CHANNEL, SEND_MESSAGES)]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'added');
  assert.deepEqual(changes[0].allow.added, ['View Channel']);
  assert.deepEqual(changes[0].deny.added, ['Send Messages']);
});

test('a removed overwrite reports what it used to hold', () => {
  // "The @Officers exception is gone" is useless without saying what it was.
  const changes = diffOverwrites([ow('42', VIEW_CHANNEL, 0n)], []);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'removed');
  assert.deepEqual(changes[0].allow.removed, ['View Channel']);
});

test('moving a permission from allow to deny is reported as BOTH changes', () => {
  // Reporting only one side would describe a lockdown as an unlock.
  const changes = diffOverwrites([ow('42', VIEW_CHANNEL, 0n)], [ow('42', 0n, VIEW_CHANNEL)]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].action, 'edited');
  assert.deepEqual(changes[0].allow.removed, ['View Channel']);
  assert.deepEqual(changes[0].deny.added, ['View Channel']);
});

test('an untouched overwrite produces no change at all', () => {
  const changes = diffOverwrites([ow('42', VIEW_CHANNEL, 0n)], [ow('42', VIEW_CHANNEL, 0n)]);
  assert.deepEqual(changes, []);
});

test('one edit touching several targets yields one change each', () => {
  const before = [ow('1', VIEW_CHANNEL, 0n), ow('2', 0n, 0n)];
  const after = [ow('1', VIEW_CHANNEL | SEND_MESSAGES, 0n), ow('2', 0n, VIEW_CHANNEL)];
  const changes = diffOverwrites(before, after);
  assert.equal(changes.length, 2);
  assert.deepEqual(
    changes.map((c) => c.id).sort(),
    ['1', '2'],
  );
});

test('a member overwrite mentions the member, a role overwrite the role', () => {
  const member = describeOverwrite({
    id: '7',
    type: 1,
    action: 'edited',
    allow: { added: ['View Channel'], removed: [] },
    deny: { added: [], removed: [] },
  });
  assert.match(member, /<@7>/);
  const role = describeOverwrite({
    id: '7',
    type: 0,
    action: 'edited',
    allow: { added: ['View Channel'], removed: [] },
    deny: { added: [], removed: [] },
  });
  assert.match(role, /<@&7>/);
});

test('a bulk edit is capped and says how many it dropped', () => {
  // A silently truncated permission log reads as a complete one.
  const descriptions = Array.from({ length: 12 }, (_, i) => `target-${i}`);
  const entry = channelPermissionsChanged({ channelId: 'c', name: 'general', descriptions });
  const body = entry.lines.join('\n');
  assert.match(body, /target-7/);
  assert.doesNotMatch(body, /target-8/);
  assert.match(body, /and 4 more targets changed/);
});

test('a single dropped target is singular', () => {
  const descriptions = Array.from({ length: 9 }, (_, i) => `t${i}`);
  const entry = channelPermissionsChanged({ channelId: 'c', name: 'general', descriptions });
  assert.match(entry.lines.join('\n'), /and 1 more target changed/);
});

test('permission entries file under the server category, which the owner points at his server-log channel', () => {
  assert.equal(rolePermissionsChanged({ roleId: '1', name: 'x', added: ['Administrator'] }).category, 'server');
  assert.equal(channelPermissionsChanged({ channelId: 'c', name: 'x', descriptions: ['y'] }).category, 'server');
});

test('overwriteSnapshot flattens a discord.js cache and survives a channel without one', () => {
  const channel = {
    permissionOverwrites: {
      cache: new Map([['42', { id: '42', type: 0, allow: { bitfield: VIEW_CHANNEL }, deny: { bitfield: 0n } }]]),
    },
  };
  assert.deepEqual(overwriteSnapshot(channel), [{ id: '42', type: 0, allow: VIEW_CHANNEL, deny: 0n }]);
  assert.deepEqual(overwriteSnapshot({}), []);
  assert.deepEqual(overwriteSnapshot(null), []);
});

// ── the handlers, which is where the bug actually was ────────────────────────
//
// The diffing above could be perfect and the owner would still see nothing:
// both handlers returned early on anything that was not a rename. These drive
// the real event functions.

const OWNER_SERVER_LOG = '494216580545380372'; // the channel the owner named

let seq = 0;
const freshGuildId = () => `20000000000000${String((seq += 1)).padStart(4, '0')}`;

function fakeGuild(guildId) {
  const sentTo = [];
  const cache = new Map();
  for (const id of [OWNER_SERVER_LOG, 'general']) {
    cache.set(id, { id, send: async (p) => (sentTo.push({ channelId: id, payload: p }), p) });
  }
  return { id: guildId, name: 'Precinct', channels: { cache }, sentTo };
}

const client = { config: { homeGuildId: null } };
const inHome = (guild) => ({ ...client, config: { homeGuildId: guild.id } });

const fakeChannel = (guild, overwrites, name = 'general') => ({
  id: 'general',
  name,
  guild,
  client: inHome(guild),
  permissionOverwrites: {
    cache: new Map(
      overwrites.map((o) => [o.id, { id: o.id, type: o.type, allow: { bitfield: o.allow }, deny: { bitfield: o.deny } }]),
    ),
  },
});

test('a permission-only channel edit is logged — the exact case the owner reported', async () => {
  const guild = fakeGuild(freshGuildId());
  // Same name on both sides: before S113 this returned early as "noise".
  const before = fakeChannel(guild, [ow('r1', VIEW_CHANNEL, 0n)]);
  const after = fakeChannel(guild, [ow('r1', VIEW_CHANNEL | SEND_MESSAGES, 0n)]);
  await onChannelUpdate.execute(before, after);
  assert.equal(guild.sentTo.length, 1, 'a permission edit alone must produce a log entry');
  assert.equal(guild.sentTo[0].channelId, OWNER_SERVER_LOG);
  const text = JSON.stringify(guild.sentTo[0].payload);
  assert.match(text, /Channel permissions changed/);
  assert.match(text, /Send Messages/);
});

test('a topic-only edit stays silent — the original "noise" judgement was right about topics', async () => {
  const guild = fakeGuild(freshGuildId());
  const overwrites = [ow('r1', VIEW_CHANNEL, 0n)];
  await onChannelUpdate.execute(fakeChannel(guild, overwrites), fakeChannel(guild, overwrites));
  assert.equal(guild.sentTo.length, 0);
});

test('a rename AND a permission change in one edit produce both entries', async () => {
  const guild = fakeGuild(freshGuildId());
  const before = fakeChannel(guild, [ow('r1', VIEW_CHANNEL, 0n)], 'old-name');
  const after = fakeChannel(guild, [ow('r1', 0n, VIEW_CHANNEL)], 'new-name');
  await onChannelUpdate.execute(before, after);
  assert.equal(guild.sentTo.length, 2, 'the rename must not swallow the permission change');
  const all = JSON.stringify(guild.sentTo);
  assert.match(all, /Channel renamed/);
  assert.match(all, /Channel permissions changed/);
});

test('granting a role Administrator is logged', async () => {
  const guild = fakeGuild(freshGuildId());
  const role = (permissions, name = 'Moderators') => ({
    id: 'r9',
    name,
    guild,
    client: inHome(guild),
    permissions: { bitfield: permissions },
  });
  await onRoleUpdate.execute(role(KICK_MEMBERS), role(KICK_MEMBERS | ADMINISTRATOR));
  assert.equal(guild.sentTo.length, 1);
  assert.equal(guild.sentTo[0].channelId, OWNER_SERVER_LOG);
  assert.match(JSON.stringify(guild.sentTo[0].payload), /Administrator/);
});

test('another guild is ignored — CuffBot logs only the home precinct', async () => {
  const guild = fakeGuild(freshGuildId());
  const foreign = { ...client, config: { homeGuildId: 'somewhere-else' } };
  const role = (permissions) => ({ id: 'r9', name: 'X', guild, client: foreign, permissions: { bitfield: permissions } });
  await onRoleUpdate.execute(role(0n), role(ADMINISTRATOR));
  assert.equal(guild.sentTo.length, 0);
});
