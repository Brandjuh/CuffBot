// Maintenance mode (S74; S75: the exempt party is the BOT owner — the
// application owner — not the guild owner): the core gate, the owner
// resolution (user- and team-owned apps, fetch retry), the router placement,
// and the bot-owner-only !maintenance group.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import {
  DEFAULT_MAINTENANCE_MESSAGE,
  getBotOwnerIds,
  getMaintenance,
  isBotOwner,
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

/** A client whose application is owned by user 'bot-owner-1' (fetch counted). */
function ownerClient({ owner = { id: 'bot-owner-1' }, failFetches = 0 } = {}) {
  const state = { fetches: 0, failLeft: failFetches };
  return {
    state,
    application: {
      owner: null, // like a real boot: owner unknown until fetched
      fetch: async function fetchApp() {
        state.fetches += 1;
        if (state.failLeft > 0) {
          state.failLeft -= 1;
          throw new Error('API down');
        }
        return { owner };
      },
    },
  };
}

// ── owner resolution ─────────────────────────────────────────────────────────

test('getBotOwnerIds resolves the application owner (user and team), caches success only', async () => {
  const client = ownerClient();
  assert.equal(await isBotOwner(client, 'bot-owner-1'), true);
  assert.equal(await isBotOwner(client, 'guild-owner'), false, 'the GUILD owner is not exempt (S75)');
  await isBotOwner(client, 'bot-owner-1');
  assert.equal(client.state.fetches, 1, 'resolved once, cached');

  const team = ownerClient({ owner: { members: new Map([['team-a', {}], ['team-b', {}]]) } });
  const ids = await getBotOwnerIds(team);
  assert.deepEqual([...ids].sort(), ['team-a', 'team-b'], 'every team member counts');

  const flaky = ownerClient({ failFetches: 1 });
  assert.equal(await isBotOwner(flaky, 'bot-owner-1'), false, 'unknown while the API fails');
  assert.equal(await isBotOwner(flaky, 'bot-owner-1'), true, 'the next check retries — no permanent lockout');
  assert.equal(flaky.state.fetches, 2);
});

// ── the gate itself ──────────────────────────────────────────────────────────

test('maintenanceNotice: off → null (no owner lookup); on → notice for everyone but the bot owner', async () => {
  const guildId = freshGuildId();
  const client = ownerClient();
  assert.equal(getMaintenance(guildId).enabled, false, 'off by default');
  assert.equal(await maintenanceNotice(client, guildId, 'member-1'), null);
  assert.equal(client.state.fetches, 0, 'the everyday path never touches the API');

  setMaintenance(guildId, { enabled: true });
  assert.equal(await maintenanceNotice(client, guildId, 'member-1'), DEFAULT_MAINTENANCE_MESSAGE);
  assert.match(DEFAULT_MAINTENANCE_MESSAGE, /under maintenance/i, 'notice is English');
  assert.match(DEFAULT_MAINTENANCE_MESSAGE, /bot owner/, 'names the BOT owner');
  assert.equal(await maintenanceNotice(client, guildId, 'bot-owner-1'), null, 'the bot owner passes');

  setMaintenance(guildId, { message: 'Back at 21:00.' });
  assert.equal(await maintenanceNotice(client, guildId, 'member-1'), 'Back at 21:00.');
  setMaintenance(guildId, { message: null });
  assert.equal(await maintenanceNotice(client, guildId, 'member-1'), DEFAULT_MAINTENANCE_MESSAGE);
});

// ── router placement (the gate must sit before BOTH dispatch paths) ──────────

function fakeRouterWorld(guildId) {
  const state = { handler: null, ran: [], replies: [] };
  const groupRan = [];
  const client = {
    ...ownerClient(),
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
    guild: { id: guildId, ownerId: 'guild-owner' },
    member: {},
    channel: { permissionsFor: () => ({ has: () => true }), send: async () => null },
    client,
    reply: async (p) => (state.replies.push(typeof p === 'string' ? { content: p } : p), { id: 'm' }),
    mentions: { users: new Map() },
  });
  return { state, groupRan, message };
}

test('the router answers the notice instead of dispatching — legacy AND group paths, bot owner exempt', async () => {
  const guildId = freshGuildId();
  setMaintenance(guildId, { enabled: true });
  const { state, groupRan, message } = fakeRouterWorld(guildId);

  await state.handler(message('!ping', 'member-1'));
  assert.equal(state.ran.length, 0, 'legacy command blocked');
  assert.match(state.replies[0].content, /under maintenance/i);
  assert.deepEqual(state.replies[0].allowedMentions, { repliedUser: false }, 'no-ping notice');

  await state.handler(message('!testgroup go', 'member-1'));
  assert.equal(groupRan.length, 0, 'group command blocked');

  await state.handler(message('!ping', 'guild-owner'));
  assert.equal(state.ran.length, 0, 'the GUILD owner is blocked too (S75 correction)');

  await state.handler(message('!unknown', 'member-1'));
  assert.equal(state.replies.length, 3, 'unknown !words stay silent — no notice spam');

  await state.handler(message('!ping', 'bot-owner-1'));
  assert.deepEqual(state.ran, ['ping'], 'the bot owner runs commands normally');
  await state.handler(message('!testgroup go', 'bot-owner-1'));
  assert.deepEqual(groupRan, ['go'], 'the bot owner reaches groups too');
});

// ── the !maintenance group ───────────────────────────────────────────────────

const group = maintenanceCommand.group;
const sub = (name) => group.subcommands.find((s) => s.name === name);

function fakeCtx(guildId, userId) {
  const replies = [];
  return {
    replies,
    prefix: '!',
    client: ownerClient(),
    guild: { id: guildId, ownerId: 'guild-owner' },
    user: { id: userId },
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

test('!maintenance is admin-visible but BOT-OWNER-only to operate', async () => {
  assert.equal(group.name, 'maintenance');
  assert.equal(group.permission, PermissionFlagsBits.Administrator, 'hidden from non-admins in help');
  assert.deepEqual(group.subcommands.map((s) => s.name), ['on', 'off', 'message', 'nomessage']);

  const guildId = freshGuildId();
  const admin = fakeCtx(guildId, 'admin-not-owner');
  await sub('on').run(admin);
  assert.match(admin.replies[0].content, /Only the bot owner/);
  assert.equal(getMaintenance(guildId).enabled, false, 'a non-owner cannot flip the switch');

  const guildOwner = fakeCtx(guildId, 'guild-owner');
  await sub('on').run(guildOwner);
  assert.match(guildOwner.replies[0].content, /Only the bot owner/, 'the guild owner is not the bot owner (S75)');
  assert.equal(getMaintenance(guildId).enabled, false);
});

test('the bot owner flips the switch and manages the notice', async () => {
  const guildId = freshGuildId();
  const owner = fakeCtx(guildId, 'bot-owner-1');

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

  const lines = group.status(fakeCtx(guildId, 'bot-owner-1'));
  assert.match(lines[0], /off — all commands open/);
});
