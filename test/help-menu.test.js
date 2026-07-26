// The help button menu (S98 = M19) and the maintenance presence (S98 = M22),
// both owner requests. The interesting half of the menu is the button pump: a
// help message is public, so anyone can press, and the roster is
// permission-filtered per viewer — those two facts decide who sees what.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ActivityType, PermissionFlagsBits, PresenceUpdateStatus } from 'discord.js';
import { categoryKeyOf, helpCategory, helpOverview } from '../src/core/help.js';
import {
  buildViewerHelp,
  helpButtonId,
  helpPayload,
  helpRows,
  parseHelpButtonId,
} from '../src/modules/core/lib/help-menu.js';
import helpButtons from '../src/modules/core/events/help-buttons.js';
import { presenceFor, presenceLabel } from '../src/modules/core/lib/presence.js';
import { syncPresence } from '../src/modules/core/service-presence.js';
import { setMaintenance } from '../src/core/maintenance.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-helpmenu-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const ASKER = '700000000000000001';
const STRANGER = '700000000000000002';

const MODULES = [
  {
    name: 'core',
    description: 'core',
    commands: [
      { command: { name: 'radiocheck', description: 'ping', args: [] } },
      { command: { name: 'update', description: 'self-update', args: [] } },
    ],
  },
  {
    name: 'enforcement',
    description: 'enf',
    commands: [
      {
        command: {
          name: 'cite',
          description: 'ticket',
          permission: PermissionFlagsBits.ModerateMembers,
          args: [],
        },
      },
    ],
  },
];

/** A permission source shaped like both a ctx and a component interaction. */
const viewer = (hasPerms) => ({
  channel: { permissionsFor: () => ({ has: () => hasPerms }) },
  member: {},
});

const modelFor = (hasPerms) => buildViewerHelp(viewer(hasPerms), '!', MODULES);

// ── the views ────────────────────────────────────────────────────────────────

test('the overview names each category with a count, so the buttons explain themselves', () => {
  const view = helpOverview(modelFor(true));
  assert.match(view.title, /Command Menu/);
  const body = JSON.stringify(view.fields);
  assert.match(body, /Moderation — \*\*1\*\*/);
  assert.ok(view.buttons.length >= 2, 'one button spec per non-empty category');
  assert.ok(view.buttons.every((b) => b.key && b.title && b.count > 0));
});

test('a viewer with nothing to run gets an honest empty overview, not a broken one', () => {
  const empty = { title: 'T', description: 'D', groups: [] };
  const view = helpOverview(empty);
  assert.deepEqual(view.buttons, []);
  assert.match(JSON.stringify(view.fields), /cannot use any commands/);
});

test('a category view carries that category’s commands and the same button set', () => {
  const model = modelFor(true);
  const view = helpCategory(model, 'moderation');
  assert.match(view.title, /Moderation/);
  assert.match(JSON.stringify(view.fields), /!cite/);
  assert.deepEqual(
    view.buttons.map((b) => b.key),
    helpOverview(model).buttons.map((b) => b.key),
    'you can jump straight to another category',
  );
});

test('asking for a category the viewer has nothing in returns null, not an empty embed', () => {
  assert.equal(helpCategory(modelFor(false), 'moderation'), null);
  assert.equal(helpCategory(modelFor(true), 'no-such-category'), null);
});

test('categoryKeyOf maps a rendered title back to its key', () => {
  assert.equal(categoryKeyOf('🛡️ Moderation'), 'moderation');
  assert.equal(categoryKeyOf('📦 Other'), 'other', 'the uncategorized bucket still round-trips');
});

// ── button ids and rows ──────────────────────────────────────────────────────

test('a button id round-trips the asker and the category', () => {
  const id = helpButtonId(ASKER, 'moderation');
  assert.deepEqual(parseHelpButtonId(id), { ownerId: ASKER, key: 'moderation' });
  assert.equal(parseHelpButtonId('trivia:answer:1'), null, 'foreign ids are not ours');
  assert.equal(parseHelpButtonId('help:'), null, 'a malformed id is refused, not guessed');
});

test('the open category’s button is disabled — that is how the menu shows where you are', () => {
  const view = helpOverview(modelFor(true));
  const rows = helpRows(view, ASKER, { active: 'moderation' });
  const buttons = rows.flatMap((r) => r.toJSON().components);
  const moderation = buttons.find((b) => b.custom_id === helpButtonId(ASKER, 'moderation'));
  assert.equal(moderation.disabled, true);
  assert.ok(
    buttons.some((b) => b.custom_id === helpButtonId(ASKER, 'overview')),
    'and a way back to all categories',
  );
});

test('the overview view offers no Back button — there is nowhere back to go', () => {
  const rows = helpRows(helpOverview(modelFor(true)), ASKER, { active: null });
  const ids = rows.flatMap((r) => r.toJSON().components).map((b) => b.custom_id);
  assert.ok(!ids.includes(helpButtonId(ASKER, 'overview')));
});

test('buttons wrap at 5 per row (Discord’s limit)', () => {
  const many = {
    title: 'T',
    description: 'D',
    groups: Array.from({ length: 8 }, (_, i) => ({ title: `Cat ${i}`, entries: [{ line: 'x' }] })),
  };
  const rows = helpRows(helpOverview(many), ASKER);
  for (const row of rows) assert.ok(row.toJSON().components.length <= 5);
  assert.equal(rows.flatMap((r) => r.toJSON().components).length, 8);
});

// ── the pump ─────────────────────────────────────────────────────────────────

function fakePress(userId, ownerId, key, { hasPerms = true } = {}) {
  const state = { updates: [], replies: [] };
  return {
    state,
    interaction: {
      isButton: () => true,
      customId: helpButtonId(ownerId, key),
      user: { id: userId },
      member: {},
      channel: { permissionsFor: () => ({ has: () => hasPerms }) },
      client: { config: { prefix: '!' }, moduleList: MODULES },
      update: async (p) => state.updates.push(p),
      reply: async (p) => state.replies.push(p),
    },
  };
}

test('the asker pressing their own button swaps the embed in place', async () => {
  const press = fakePress(ASKER, ASKER, 'moderation');
  await helpButtons.execute(press.interaction);
  assert.equal(press.state.updates.length, 1, 'the message is edited');
  assert.equal(press.state.replies.length, 0, 'nothing extra is posted');
  assert.match(JSON.stringify(press.state.updates[0].embeds[0].toJSON()), /!cite/);
});

test('someone ELSE pressing gets their own view privately — the asker’s menu is untouched', async () => {
  const press = fakePress(STRANGER, ASKER, 'info');
  await helpButtons.execute(press.interaction);
  assert.equal(press.state.updates.length, 0, 'the shared message is not rewritten');
  assert.equal(press.state.replies.length, 1);
  assert.equal(press.state.replies[0].flags, 64, 'a component reply can still be ephemeral');
  // Their buttons are keyed to THEM, so pressing on keeps working privately.
  const ids = press.state.replies[0].components
    .flatMap((r) => r.toJSON().components)
    .map((b) => b.custom_id);
  assert.ok(ids.every((id) => id.includes(STRANGER)));
});

test('a presser with nothing in that category is told so, not shown an empty embed', async () => {
  const press = fakePress(STRANGER, ASKER, 'moderation', { hasPerms: false });
  await helpButtons.execute(press.interaction);
  assert.equal(press.state.updates.length, 0);
  assert.match(press.state.replies[0].content, /no commands in that category/);
});

test('the overview button goes back, and foreign buttons are ignored', async () => {
  const back = fakePress(ASKER, ASKER, 'overview');
  await helpButtons.execute(back.interaction);
  assert.match(JSON.stringify(back.state.updates[0].embeds[0].toJSON()), /Pick a category/);

  const foreign = fakePress(ASKER, ASKER, 'x');
  foreign.interaction.customId = 'trivia:answer:1';
  await helpButtons.execute(foreign.interaction);
  assert.equal(foreign.state.updates.length, 0, 'not ours — untouched');
  assert.equal(foreign.state.replies.length, 0);
});

test('a non-button interaction is ignored outright', async () => {
  const state = { replies: [] };
  await helpButtons.execute({
    isButton: () => false,
    customId: helpButtonId(ASKER, 'info'),
    reply: async (p) => state.replies.push(p),
  });
  assert.equal(state.replies.length, 0);
});

test('helpPayload is a complete, ping-free message', () => {
  const payload = helpPayload(helpOverview(modelFor(true)), ASKER);
  assert.equal(payload.embeds.length, 1);
  assert.ok(payload.components.length >= 1);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
});

// ── M22: maintenance in the bot's status ─────────────────────────────────────

test('the two presences are distinguishable at a glance', () => {
  const normal = presenceFor(false);
  const busy = presenceFor(true);
  assert.equal(normal.status, PresenceUpdateStatus.Online);
  assert.equal(normal.activities[0].type, ActivityType.Watching);
  assert.equal(busy.status, PresenceUpdateStatus.DoNotDisturb);
  assert.match(busy.activities[0].name, /Maintenance/);
  assert.notEqual(normal.status, busy.status, 'the dot colour alone tells them apart');
  assert.match(presenceLabel(true), /Maintenance/);
  assert.match(presenceLabel(false), /Online/);
});

test('the presence is read from STORAGE, so it survives a restart', () => {
  const guildId = '411157175948541954';
  const applied = [];
  const client = { config: { homeGuildId: guildId }, user: { setPresence: (p) => applied.push(p) } };

  setMaintenance(guildId, { enabled: true });
  assert.equal(syncPresence(client), true, 'boot reads the stored state, not a variable');
  assert.equal(applied.at(-1).status, PresenceUpdateStatus.DoNotDisturb);

  setMaintenance(guildId, { enabled: false });
  assert.equal(syncPresence(client), false);
  assert.equal(applied.at(-1).status, PresenceUpdateStatus.Online);
});

test('a presence failure never takes down the caller — it is cosmetic', () => {
  const client = {
    config: { homeGuildId: '411157175948541954' },
    user: {
      setPresence: () => {
        throw new Error('gateway hiccup');
      },
    },
  };
  assert.doesNotThrow(() => syncPresence(client));
  // And a client with no user yet (pre-ready) is simply a no-op.
  assert.doesNotThrow(() => syncPresence({ config: { homeGuildId: 'g' } }));
});
