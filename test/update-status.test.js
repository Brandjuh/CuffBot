import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyPollTick,
  clearUpdateMarker,
  getHead,
  MARKER_FRESH_MS,
  takeFreshUpdateMarker,
  writeUpdateMarker,
} from '../src/modules/core/update-status.js';
import updateReport from '../src/modules/core/events/update-report.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-update-status-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `20000000000000${String((seq += 1)).padStart(4, '0')}`;

test('getHead reads the repo commit (real git) and degrades to nulls', () => {
  const real = getHead();
  assert.match(real.head ?? '', /^[0-9a-f]{7,}$/, 'short hash from the actual checkout');
  assert.equal(typeof real.subject, 'string');
  const broken = getHead(() => ({ status: 1, stdout: '' }));
  assert.deepEqual(broken, { head: null, subject: null });
});

test('classifyPollTick: unchanged → fetched → rolled-back transitions', () => {
  assert.equal(classifyPollTick('aaa', 'aaa', 'aaa'), 'unchanged');
  assert.equal(classifyPollTick('aaa', 'aaa', 'bbb'), 'fetched');
  assert.equal(classifyPollTick('aaa', 'bbb', 'bbb'), 'fetched', 'still on the new commit');
  assert.equal(classifyPollTick('aaa', 'bbb', 'aaa'), 'rolled-back', 'came back to the start');
});

test('update marker: write → take-once (fresh), stale markers vanish silently', () => {
  const guildId = freshGuildId();
  const now = 10_000_000;
  writeUpdateMarker(guildId, { channelId: 'c1', requesterId: 'u1', startedHead: 'aaa', at: now });
  const taken = takeFreshUpdateMarker(guildId, now + 60_000);
  assert.equal(taken.channelId, 'c1');
  assert.equal(takeFreshUpdateMarker(guildId, now + 61_000), null, 'take clears the marker');

  writeUpdateMarker(guildId, { channelId: 'c1', requesterId: 'u1', startedHead: 'aaa', at: now });
  assert.equal(takeFreshUpdateMarker(guildId, now + MARKER_FRESH_MS + 1), null, 'stale = ignored');
  assert.equal(takeFreshUpdateMarker(guildId, now), null, 'and cleared');

  clearUpdateMarker(guildId); // idempotent
});

function fakeClient(guildId, marker) {
  const sends = [];
  if (marker) writeUpdateMarker(guildId, marker);
  const channel = { id: 'chan-1', send: async (p) => (sends.push(p), p) };
  return {
    sends,
    client: {
      config: { homeGuildId: guildId },
      guilds: { cache: new Map([[guildId, { id: guildId, channels: { cache: new Map([['chan-1', channel]]) } }]]) },
    },
  };
}

test('boot reporter announces a version change and pings only the requester', async () => {
  const guildId = freshGuildId();
  const { client, sends } = fakeClient(guildId, {
    channelId: 'chan-1',
    requesterId: 'u9',
    startedHead: 'ffffffff', // never equals the real HEAD
    at: Date.now(),
  });
  await updateReport.execute(client);
  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /Update complete/);
  assert.match(sends[0].content, /<@u9>/);
  assert.deepEqual(sends[0].allowedMentions, { users: ['u9'] });
  await updateReport.execute(client);
  assert.equal(sends.length, 1, 'marker consumed — a normal restart stays silent');
});

test('boot reporter reports a same-version restart as rollback/restart', async () => {
  const guildId = freshGuildId();
  const { head } = getHead();
  const { client, sends } = fakeClient(guildId, {
    channelId: 'chan-1',
    requesterId: 'u9',
    startedHead: head, // same version as "now"
    at: Date.now(),
  });
  await updateReport.execute(client);
  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /SAME version/);
});

test('boot reporter stays silent without a marker or without the channel', async () => {
  const none = fakeClient(freshGuildId(), null);
  await updateReport.execute(none.client);
  assert.equal(none.sends.length, 0);

  const guildId = freshGuildId();
  const gone = fakeClient(guildId, { channelId: 'deleted-chan', requesterId: 'u1', startedHead: 'aaa', at: Date.now() });
  await updateReport.execute(gone.client);
  assert.equal(gone.sends.length, 0, 'deleted channel → no crash, no send');
});

test('boot reporter announces a deliberate restart with the restart message (S28)', async () => {
  const guildId = freshGuildId();
  const { client, sends } = fakeClient(guildId, {
    channelId: 'chan-1',
    requesterId: 'u5',
    startedHead: 'whatever',
    at: Date.now(),
    kind: 'restart',
  });
  await updateReport.execute(client);
  assert.equal(sends.length, 1);
  assert.match(sends[0].content, /Restart complete — configuration reloaded/);
  assert.match(sends[0].content, /<@u5>/);
});
