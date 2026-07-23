import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { announcementEmbed, enforcementEmbed } from '../src/modules/dispatch/lib/format.js';
import {
  clearEvidenceLocker,
  getEvidenceLocker,
  logEnforcement,
  resolveLocker,
  setEvidenceLocker,
} from '../src/modules/dispatch/lib/api.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-dispatch-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';

test('enforcementEmbed builds a typed embed with officer, case, and reason', () => {
  const embed = enforcementEmbed({
    type: 'arrest',
    subject: '<@5>',
    officer: '<@1>',
    reason: 'spam',
    caseNumber: 7,
    fields: [{ name: 'Message wipe', value: 'last 24 hours', inline: true }],
  });
  assert.match(embed.title, /Arrest/);
  assert.equal(embed.color, 0xcc3a3a);
  const names = embed.fields.map((f) => f.name);
  assert.deepEqual(names, ['Officer', 'Case', 'Message wipe', 'Reason']);
  assert.equal(embed.fields.find((f) => f.name === 'Case').value, '#0007');
  assert.equal(embed.fields.find((f) => f.name === 'Reason').value, 'spam');
});

test('enforcementEmbed defaults a blank reason and omits case when absent', () => {
  const embed = enforcementEmbed({ type: 'citation', subject: 'x', officer: 'y', reason: '  ' });
  assert.ok(!embed.fields.some((f) => f.name === 'Case'));
  assert.equal(embed.fields.find((f) => f.name === 'Reason').value, 'No reason given');
});

test('enforcementEmbed rejects unknown types', () => {
  assert.throws(() => enforcementEmbed({ type: 'compliment', subject: 'x', officer: 'y' }), /Unknown/);
});

test('announcementEmbed carries the message and issuer', () => {
  const embed = announcementEmbed({ message: 'All units, code 3.', officer: 'brand' });
  assert.equal(embed.description, 'All units, code 3.');
  assert.match(embed.footer.text, /brand/);
});

test('evidence-locker set/status/clear roundtrip through the store', () => {
  assert.equal(getEvidenceLocker(GUILD), null);
  setEvidenceLocker(GUILD, '123456789012345678');
  assert.equal(getEvidenceLocker(GUILD), '123456789012345678');
  clearEvidenceLocker(GUILD);
  assert.equal(getEvidenceLocker(GUILD), null);
});

test('resolveLocker reports why it cannot deliver', async () => {
  clearEvidenceLocker(GUILD);
  assert.deepEqual(await resolveLocker({ id: GUILD }), { channel: null, reason: 'not-configured' });

  setEvidenceLocker(GUILD, '999');
  const missing = await resolveLocker({
    id: GUILD,
    channels: { cache: new Map(), fetch: async () => null },
  });
  assert.equal(missing.reason, 'channel-missing');
  clearEvidenceLocker(GUILD);
});

test('logEnforcement sends an embed to the configured channel', async () => {
  const sent = [];
  const channel = { send: async (payload) => sent.push(payload) };
  const guild = {
    id: GUILD,
    channels: { cache: new Map([['777', channel]]), fetch: async () => channel },
    members: { me: {} },
  };
  setEvidenceLocker(GUILD, '777');
  const result = await logEnforcement(guild, {
    type: 'citation',
    subject: '<@5>',
    officer: '<@1>',
    reason: 'spam',
    caseNumber: 1,
  });
  assert.equal(result.delivered, true);
  assert.equal(sent.length, 1);
  assert.ok(sent[0].embeds[0].title.includes('Citation'));
  clearEvidenceLocker(GUILD);
});

test('resolveLocker reports no-permission when the bot cannot post there', async () => {
  const { PermissionFlagsBits } = await import('discord.js');
  const channel = { send: async () => {} };
  const guild = {
    id: GUILD,
    channels: { cache: new Map([['777', channel]]), fetch: async () => channel },
    members: { me: {} },
  };
  channel.permissionsFor = () => ({ has: (f) => f !== PermissionFlagsBits.SendMessages });
  setEvidenceLocker(GUILD, '777');
  const r = await resolveLocker(guild);
  assert.equal(r.reason, 'no-permission');
  clearEvidenceLocker(GUILD);
});

test('logEnforcement reports send-failed when the channel send throws', async () => {
  const channel = { send: async () => { throw new Error('boom'); } };
  const guild = {
    id: GUILD,
    channels: { cache: new Map([['777', channel]]), fetch: async () => channel },
    members: { me: {} },
  };
  setEvidenceLocker(GUILD, '777');
  const r = await logEnforcement(guild, { type: 'citation', subject: 'x', officer: 'y', reason: 'z' });
  assert.deepEqual(r, { delivered: false, reason: 'send-failed' });
  clearEvidenceLocker(GUILD);
});

test('logEnforcement is a graceful no-op when no locker is configured', async () => {
  clearEvidenceLocker(GUILD);
  const result = await logEnforcement({ id: GUILD, channels: { cache: new Map() } }, {
    type: 'citation',
    subject: 'x',
    officer: 'y',
    reason: 'z',
  });
  assert.deepEqual(result, { delivered: false, reason: 'not-configured' });
});
