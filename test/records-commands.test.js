import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import rapsheet from '../src/modules/records/commands/rapsheet.js';
import expunge from '../src/modules/records/commands/expunge.js';
import { addRecord } from '../src/modules/records/lib/api.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-recsheet-test-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';
const MOD = PermissionFlagsBits.ModerateMembers;
const MANAGE = PermissionFlagsBits.ManageGuild;

function fakeUser(id, name) {
  return { id, username: name, displayName: name, toString: () => `<@${id}>` };
}

function fakeInteraction({ perms = [], target, caseNumber = null }) {
  const replies = [];
  return {
    replies,
    user: fakeUser('111', 'officer'),
    client: { user: { id: '999' } },
    memberPermissions: { has: (flag) => perms.includes(flag) },
    guild: { id: GUILD, name: 'Test Precinct' },
    options: {
      getUser: () => target,
      getInteger: () => caseNumber,
      getString: () => null,
    },
    reply: async (payload) => {
      replies.push(typeof payload === 'string' ? { content: payload } : payload);
    },
  };
}

test('rapsheet: blocked without Moderate Members', async () => {
  const ix = fakeInteraction({ perms: [], target: fakeUser('5', 'perp') });
  await rapsheet.execute(ix);
  assert.match(ix.replies[0].content, /jurisdiction/i);
});

test('rapsheet: clean sheet reads as clean', async () => {
  const ix = fakeInteraction({ perms: [MOD], target: fakeUser('nobody', 'saint') });
  await rapsheet.execute(ix);
  assert.match(ix.replies[0].content, /Clean sheet/);
});

test('rapsheet: shows filed records, ephemeral', async () => {
  addRecord(GUILD, { type: 'citation', userId: '5', officerId: '111', reason: 'spam' });
  addRecord(GUILD, { type: 'arrest', userId: '5', officerId: '111', reason: 'worse spam' });
  const ix = fakeInteraction({ perms: [MOD], target: fakeUser('5', 'perp') });
  await rapsheet.execute(ix);
  const reply = ix.replies[0];
  assert.match(reply.content, /RAP SHEET — PERP/);
  assert.match(reply.content, /1 citation/);
  assert.match(reply.content, /1 arrest/);
  assert.ok(reply.flags, 'rap sheets are ephemeral');
});

test('expunge: demands Manage Server, not just moderation', async () => {
  const ix = fakeInteraction({ perms: [MOD], target: fakeUser('5', 'perp') });
  await expunge.execute(ix);
  assert.match(ix.replies[0].content, /Manage Server/);
});

test('expunge: erases one case, then reports a clean miss', async () => {
  addRecord(GUILD, { type: 'citation', userId: '6', officerId: '111', reason: 'jaywalking' });
  const filed = addRecord(GUILD, { type: 'citation', userId: '6', officerId: '111', reason: 'double parking' });

  const one = fakeInteraction({ perms: [MANAGE], target: fakeUser('6', 'perp'), caseNumber: filed.caseNumber });
  await expunge.execute(one);
  assert.match(one.replies[0].content, new RegExp(`Case #${filed.caseNumber} expunged`));

  const again = fakeInteraction({ perms: [MANAGE], target: fakeUser('6', 'perp'), caseNumber: filed.caseNumber });
  await expunge.execute(again);
  assert.match(again.replies[0].content, /Nothing expunged/);

  const all = fakeInteraction({ perms: [MANAGE], target: fakeUser('6', 'perp') });
  await expunge.execute(all);
  assert.match(all.replies[0].content, /1 record\(s\) erased/);
});
