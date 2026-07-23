import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import evidenceLocker from '../src/modules/dispatch/commands/evidence-locker.js';
import dispatch from '../src/modules/dispatch/commands/dispatch.js';
import { getEvidenceLocker } from '../src/modules/dispatch/lib/api.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-dispatch-cmd-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';
const MANAGE = PermissionFlagsBits.ManageGuild;
const MANAGE_MSG = PermissionFlagsBits.ManageMessages;

function fakeInteraction({ perms = [], action = null, message = null, channelId = 'chan-1' }) {
  const replies = [];
  const channelSends = [];
  return {
    replies,
    channelSends,
    user: { id: '1', username: 'officer', displayName: 'officer', toString: () => '<@1>' },
    memberPermissions: { has: (flag) => perms.includes(flag) },
    guild: { id: GUILD },
    channel: {
      id: channelId,
      toString: () => `<#${channelId}>`,
      send: async (p) => channelSends.push(p),
    },
    options: {
      getString: (name) => (name === 'action' ? action : name === 'message' ? message : null),
    },
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

test('evidence-locker requires Manage Server', async () => {
  const ix = fakeInteraction({ perms: [], action: 'set' });
  await evidenceLocker.execute(ix);
  assert.match(ix.replies[0].content, /Manage Server/);
});

test('evidence-locker set stores the current channel; status reports it; clear removes it', async () => {
  const set = fakeInteraction({ perms: [MANAGE], action: 'set', channelId: 'log-chan' });
  await evidenceLocker.execute(set);
  assert.equal(getEvidenceLocker(GUILD), 'log-chan');
  assert.match(set.replies[0].content, /set to/i);

  const status = fakeInteraction({ perms: [MANAGE], action: 'status' });
  await evidenceLocker.execute(status);
  assert.match(status.replies[0].content, /log-chan/);

  const clear = fakeInteraction({ perms: [MANAGE], action: 'clear' });
  await evidenceLocker.execute(clear);
  assert.equal(getEvidenceLocker(GUILD), null);
});

test('evidence-locker status with nothing configured explains how to set it', async () => {
  const ix = fakeInteraction({ perms: [MANAGE], action: null }); // defaults to status
  await evidenceLocker.execute(ix);
  assert.match(ix.replies[0].content, /No evidence locker configured/);
});

test('dispatch posts an announcement embed and confirms', async () => {
  const ix = fakeInteraction({ perms: [MANAGE_MSG], message: 'All units, code 3.' });
  await dispatch.execute(ix);
  assert.equal(ix.channelSends.length, 1);
  assert.equal(ix.channelSends[0].embeds[0].description, 'All units, code 3.');
  assert.match(ix.replies[0].content, /Dispatched/);
});

test('dispatch requires Manage Messages', async () => {
  const ix = fakeInteraction({ perms: [], message: 'hi' });
  await dispatch.execute(ix);
  assert.match(ix.replies[0].content, /Manage Messages/);
  assert.equal(ix.channelSends.length, 0);
});
