import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import patrolEvent from '../src/modules/patrol/events/patrol.js';
import { setPatrolConfig } from '../src/modules/patrol/service.js';
import { recordsFor } from '../src/modules/records/lib/api.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-patrol-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';

function fakeMessage({ content, isMod = false, contentIntent = true, bot = false }) {
  const state = { deleted: false, dm: null };
  return {
    state,
    content,
    author: { id: 'u1', bot, toString: () => '<@u1>', send: async (m) => { state.dm = m; } },
    member: { permissions: { has: (f) => (isMod ? f === PermissionFlagsBits.ManageMessages : false) } },
    guild: {
      id: GUILD,
      name: 'Precinct',
      channels: { cache: new Map() },
      members: { me: {} },
    },
    client: {
      user: { id: 'bot', toString: () => '<@bot>' },
      config: { homeGuildId: GUILD },
      messageContentAvailable: contentIntent,
    },
    delete: async () => { state.deleted = true; },
  };
}

test('patrol removes a banned-term message and files a record', async () => {
  setPatrolConfig(GUILD, { enabled: true, rules: { bannedTerms: true, invites: true, spam: true }, bannedTerms: ['badword'] });
  const msg = fakeMessage({ content: 'this is a b@dw0rd' });
  await patrolEvent.execute(msg);
  assert.equal(msg.state.deleted, true, 'message deleted');
  assert.ok(msg.state.dm, 'author warned via DM');
  const records = recordsFor(GUILD, 'u1');
  assert.equal(records.length, 1);
  assert.match(records[0].reason, /Auto-patrol/);
});

test('patrol ignores moderators', async () => {
  setPatrolConfig(GUILD, { enabled: true, rules: { bannedTerms: true, invites: true, spam: true }, bannedTerms: ['badword'] });
  const msg = fakeMessage({ content: 'badword', isMod: true });
  await patrolEvent.execute(msg);
  assert.equal(msg.state.deleted, false);
});

test('patrol is a no-op when disabled or the intent is off', async () => {
  setPatrolConfig(GUILD, { enabled: false, rules: { bannedTerms: true, invites: true, spam: true }, bannedTerms: ['badword'] });
  const off = fakeMessage({ content: 'badword' });
  await patrolEvent.execute(off);
  assert.equal(off.state.deleted, false);

  setPatrolConfig(GUILD, { enabled: true, rules: { bannedTerms: true, invites: true, spam: true }, bannedTerms: ['badword'] });
  const noIntent = fakeMessage({ content: 'badword', contentIntent: false });
  await patrolEvent.execute(noIntent);
  assert.equal(noIntent.state.deleted, false);
});

test('patrol ignores clean messages and bots', async () => {
  setPatrolConfig(GUILD, { enabled: true, rules: { bannedTerms: true, invites: true, spam: true }, bannedTerms: ['badword'] });
  const clean = fakeMessage({ content: 'a perfectly nice message' });
  await patrolEvent.execute(clean);
  assert.equal(clean.state.deleted, false);

  const botMsg = fakeMessage({ content: 'badword', bot: true });
  await patrolEvent.execute(botMsg);
  assert.equal(botMsg.state.deleted, false);
});
