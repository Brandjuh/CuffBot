import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import patrol from '../src/modules/patrol/commands/patrol.js';
import patrolRule from '../src/modules/patrol/commands/patrol-rule.js';
import patrolTerm from '../src/modules/patrol/commands/patrol-term.js';
import { getPatrolConfig } from '../src/modules/patrol/service.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-patrol-cmd-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';
const MANAGE = PermissionFlagsBits.ManageGuild;

function fakeInteraction({ perms = [], options = {}, contentIntent = true }) {
  const replies = [];
  return {
    replies,
    memberPermissions: { has: (f) => perms.includes(f) },
    guild: { id: GUILD },
    client: { messageContentAvailable: contentIntent },
    options: { getString: (n) => options[n] ?? null },
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

test('patrol requires Manage Server', async () => {
  const ix = fakeInteraction({ perms: [], options: { action: 'on' } });
  await patrol.execute(ix);
  assert.match(ix.replies[0].content, /Manage Server/);
});

test('patrol on/off flips the stored flag and status shows it', async () => {
  const on = fakeInteraction({ perms: [MANAGE], options: { action: 'on' } });
  await patrol.execute(on);
  assert.equal(getPatrolConfig(GUILD).enabled, true);

  const status = fakeInteraction({ perms: [MANAGE], options: {} });
  await patrol.execute(status);
  const desc = status.replies[0].embeds[0].data?.description ?? status.replies[0].embeds[0].description;
  assert.match(desc, /Patrol:.*on/);
});

test('patrol warns when the Message Content intent is off', async () => {
  const ix = fakeInteraction({ perms: [MANAGE], options: {}, contentIntent: false });
  await patrol.execute(ix);
  const embed = ix.replies[0].embeds[0];
  const fields = embed.data?.fields ?? embed.fields ?? [];
  assert.ok(fields.some((f) => /Message Content/.test(f.name)));
});

test('patrol-rule toggles a category', async () => {
  const ix = fakeInteraction({ perms: [MANAGE], options: { rule: 'invites', state: 'off' } });
  await patrolRule.execute(ix);
  assert.equal(getPatrolConfig(GUILD).rules.invites, false);
  assert.match(ix.replies[0].content, /Invite links.*off/);
});

test('patrol-term adds and removes without echoing the term publicly', async () => {
  const add = fakeInteraction({ perms: [MANAGE], options: { action: 'add', term: 'BadWord' } });
  await patrolTerm.execute(add);
  assert.ok(getPatrolConfig(GUILD).bannedTerms.includes('badword'));
  assert.ok(!/badword/i.test(add.replies[0].content), 'reply does not repeat the term');
  assert.equal(add.replies[0].flags, MessageFlags.Ephemeral);

  const remove = fakeInteraction({ perms: [MANAGE], options: { action: 'remove', term: 'badword' } });
  await patrolTerm.execute(remove);
  assert.ok(!getPatrolConfig(GUILD).bannedTerms.includes('badword'));
});
