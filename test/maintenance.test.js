// Maintenance mode (S74, owner request): the core gate, the router placement,
// and the owner-only !maintenance group.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  getMaintenance,
  maintenanceNotice,
  setMaintenance,
} from '../src/core/maintenance.js';
import { wirePrefixRouter } from '../src/core/prefix/router.js';
import maintenanceCommand from '../src/modules/core/commands/maintenance.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-maintenance-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `74000000000000${String((seq += 1)).padStart(4, '0')}`;

// ── the gate itself ──────────────────────────────────────────────────────────

test('maintenanceNotice: off → null; on → default notice for everyone but the owner', () => {
  const guildId = freshGuildId();
  const guild = { id: guildId, ownerId: 'owner-1' };
  assert.equal(getMaintenance(guildId).enabled, false, 'off by default');
  assert.equal(maintenanceNotice(guild, 'member-1'), null);

  setMaintenance(guildId, { enabled: true });
  assert.equal(maintenanceNotice(guild, 'member-1'), DEFAULT_MAINTENANCE_MESSAGE);
  assert.match(maintenanceNotice(guild, 'member-1'), /under maintenance/i, 'notice is English');
  assert.equal(maintenanceNotice(guild, 'owner-1'), null, 'the precinct owner passes');

  setMaintenance(guildId, { message: 'Back at 21:00.' });
  assert.equal(maintenanceNotice(guild, 'member-1'), 'Back at 21:00.');
  setMaintenance(guildId, { message: null });
  assert.equal(maintenanceNotice(guild, 'member-1'), DEFAULT_MAINTENANCE_MESSAGE);
});

// ── router placement (the gate must sit before BOTH dispatch paths) ──────────

function fakeRouterWorld(guildId) {
  const state = { handler: null, ran: [], replies: [] };
  const groupRan = [];
  const client = {
    config: { prefix: '!' },
    commands: new Map([
      [
        'ping',
        { data: { name: 'ping', toJSON: () => ({ name: 'ping', description: 'x', options: [] }) }, execute: async () => {} },
      ],
      [
        'testgroup',
        { group: { name: 'testgroup', description: 'x', subcommands: [{ name: 'go', description: 'x', args: [], run: async () => groupRan.push('go') }] } },
      ],
    ]),
    on: (event, fn) => (state.handler = fn),
  };
  wirePrefixRouter(client, async (command, interaction) => state.ran.push(command.data.name));
  const message = (content, authorId) => ({
    content,
    author: { id: authorId, bot: false },
    guild: { id: guildId, ownerId: 'owner-1' },
    member: {},
    channel: { permissionsFor: () => ({ has: () => true }), send: async () => null },
    client,
    reply: async (p) => (state.replies.push(typeof p === 'string' ? { content: p } : p), { id: 'm' }),
    mentions: { users: new Map() },
  });
  return { state, groupRan, message };
}

test('the router answers the notice instead of dispatching — legacy AND group paths, owner exempt', async () => {
  const guildId = freshGuildId();
  setMaintenance(guildId, { enabled: true });
  const { state, groupRan, message } = fakeRouterWorld(guildId);

  await state.handler(message('!ping', 'member-1'));
  assert.equal(state.ran.length, 0, 'legacy command blocked');
  assert.match(state.replies[0].content, /under maintenance/i);
  assert.deepEqual(state.replies[0].allowedMentions, { repliedUser: false }, 'no-ping notice');

  await state.handler(message('!testgroup go', 'member-1'));
  assert.equal(groupRan.length, 0, 'group command blocked');

  await state.handler(message('!unknown', 'member-1'));
  assert.equal(state.replies.length, 2, 'unknown !words stay silent — no notice spam');

  await state.handler(message('!ping', 'owner-1'));
  assert.deepEqual(state.ran, ['ping'], 'the owner runs commands normally');
  await state.handler(message('!testgroup go', 'owner-1'));
  assert.deepEqual(groupRan, ['go'], 'the owner reaches groups too');
});

// ── the !maintenance group ───────────────────────────────────────────────────

const group = maintenanceCommand.group;
const sub = (name) => group.subcommands.find((s) => s.name === name);

function fakeCtx(guildId, userId) {
  const replies = [];
  return {
    replies,
    prefix: '!',
    guild: { id: guildId, ownerId: 'owner-1' },
    user: { id: userId },
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

test('!maintenance is admin-visible but OWNER-only to operate', async () => {
  assert.equal(group.name, 'maintenance');
  assert.equal(group.permission, PermissionFlagsBits.Administrator, 'hidden from non-admins in help');
  assert.deepEqual(group.subcommands.map((s) => s.name), ['on', 'off', 'message', 'nomessage']);

  const guildId = freshGuildId();
  const admin = fakeCtx(guildId, 'admin-not-owner');
  await sub('on').run(admin);
  assert.match(admin.replies[0].content, /Only the precinct owner/);
  assert.equal(getMaintenance(guildId).enabled, false, 'an admin cannot lock themselves out');
});

test('the owner flips the switch and manages the notice', async () => {
  const guildId = freshGuildId();
  const owner = fakeCtx(guildId, 'owner-1');

  await sub('on').run(owner);
  assert.equal(getMaintenance(guildId).enabled, true);
  assert.match(owner.replies[0].content, /Maintenance mode is \*\*ON\*\*/);

  await sub('message').run(owner, { text: 'Server upgrade — back tonight.' });
  assert.equal(getMaintenance(guildId).message, 'Server upgrade — back tonight.');

  await sub('nomessage').run(owner);
  assert.equal(getMaintenance(guildId).message, null);

  await sub('off').run(owner);
  assert.equal(getMaintenance(guildId).enabled, false);
  assert.match(owner.replies.at(-1).content, /back on duty/);

  const lines = group.status(fakeCtx(guildId, 'owner-1'));
  assert.match(lines[0], /off — all commands open/);
});
