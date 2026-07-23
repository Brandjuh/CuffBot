import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { MessageFlags } from 'discord.js';
import badge from '../src/modules/public-affairs/commands/badge.js';
import donut from '../src/modules/public-affairs/commands/donut.js';
import report911 from '../src/modules/public-affairs/commands/911.js';
import { addRecord } from '../src/modules/records/lib/api.js';
import { setEvidenceLocker, clearEvidenceLocker } from '../src/modules/dispatch/lib/api.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-pa-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';

function fakeUser(id, name) {
  return {
    id,
    username: name,
    displayName: name,
    toString: () => `<@${id}>`,
    displayAvatarURL: () => `http://avatar/${id}.png`,
  };
}

function fakeInteraction({ self, target = null, options = {}, roleCache = new Map(), lockerChannel = null }) {
  const replies = [];
  const member = {
    displayName: (target ?? self).username,
    joinedTimestamp: 1_700_000_000_000,
    roles: { cache: roleCache },
  };
  return {
    replies,
    user: self,
    guild: {
      id: GUILD,
      roles: { cache: new Map() },
      members: { me: {}, fetch: async () => member },
      channels: {
        cache: lockerChannel ? new Map([[lockerChannel.id, lockerChannel]]) : new Map(),
        fetch: async () => lockerChannel,
      },
    },
    options: {
      getUser: (n) => (n === 'target' ? target : null),
      getString: (n) => options[n] ?? null,
      getBoolean: (n) => options[n] ?? null,
    },
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

test('badge shows a card even with no rank and no records', async () => {
  const self = fakeUser('1', 'officer');
  const ix = fakeInteraction({ self, target: null });
  await badge.execute(ix);
  const embed = ix.replies[0].embeds[0];
  const title = embed.data?.title ?? embed.title;
  assert.match(title, /officer/);
});

test('badge reflects filed records', async () => {
  addRecord(GUILD, { type: 'citation', userId: '9', officerId: '1', reason: 'x' });
  const ix = fakeInteraction({ self: fakeUser('1', 'off'), target: fakeUser('9', 'perp') });
  await badge.execute(ix);
  const embed = ix.replies[0].embeds[0];
  const fields = embed.data?.fields ?? embed.fields;
  assert.equal(fields.find((f) => f.name === 'Record').value, '1 entry');
});

test('donut hands out a treat', async () => {
  const self = fakeUser('1', 'off');
  const ix = fakeInteraction({ self, target: fakeUser('2', 'buddy') });
  await donut.execute(ix);
  assert.match(ix.replies[0].content, /hands <@2>/);
  assert.match(ix.replies[0].content, /🍩/);
});

test('911 files to the evidence locker and confirms privately', async () => {
  const sent = [];
  const channel = { id: 'locker', send: async (p) => sent.push(p) };
  setEvidenceLocker(GUILD, 'locker');
  const ix = fakeInteraction({
    self: fakeUser('1', 'reporter'),
    target: fakeUser('2', 'suspect'),
    options: { reason: 'being loud', anonymous: true },
    lockerChannel: channel,
  });
  await report911.execute(ix);
  assert.equal(sent.length, 1, 'report delivered to locker');
  assert.match(sent[0].embeds[0].title, /911/);
  assert.match(sent[0].embeds[0].fields.find((f) => f.name === 'Reporter').value, /Anonymous/);
  assert.equal(ix.replies[0].flags, MessageFlags.Ephemeral);
  assert.match(ix.replies[0].content, /filed with the force/);
  clearEvidenceLocker(GUILD);
});

test('911 tells the reporter when no locker is configured', async () => {
  clearEvidenceLocker(GUILD);
  const ix = fakeInteraction({
    self: fakeUser('1', 'reporter'),
    target: fakeUser('2', 'suspect'),
    options: { reason: 'x' },
  });
  await report911.execute(ix);
  assert.match(ix.replies[0].content, /no evidence-locker channel configured/);
  assert.equal(ix.replies[0].flags, MessageFlags.Ephemeral);
});
