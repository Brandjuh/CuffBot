import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  classifyPollTick,
  clearUpdateMarker,
  DEFAULT_UPDATE_CHANNEL_ID,
  getHead,
  getSeenVersion,
  MARKER_FRESH_MS,
  rememberVersion,
  takeFreshUpdateMarker,
  stalledUpdateReport,
  updateAnnouncement,
  updaterUnitStatus,
  versionChange,
  writeUpdateMarker,
} from '../src/modules/core/update-status.js';
import updateReport from '../src/modules/core/events/update-report.js';
import updateAnnounce from '../src/modules/core/events/update-announce.js';

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

// ── unattended-update announcements (S117) ───────────────────────────────────
//
// Owner: "Zodra er automatisch een update is geïnstalleerd laat dat weten in
// 412334189879230474." The 15-minute timer had nobody waiting on it, so its
// updates landed in silence.

test('the owner’s update channel is a committed default', () => {
  // Typed out again rather than imported into the assertion, so this can
  // actually disagree with the constant (S111 / skill 0.5.35). And a STRING:
  // an unquoted 18-digit snowflake is silently rounded by Number.
  assert.equal(DEFAULT_UPDATE_CHANNEL_ID, '412334189879230474');
  assert.equal(typeof DEFAULT_UPDATE_CHANNEL_ID, 'string');
});

test('a changed commit is announced; an unchanged one is not', () => {
  assert.deepEqual(versionChange({ head: 'bbb' }, { head: 'aaa' }), {
    announce: true,
    reason: 'updated',
    from: 'aaa',
    to: 'bbb',
  });
  assert.equal(versionChange({ head: 'aaa' }, { head: 'aaa' }).announce, false);
});

test('the first boot ever records the version and stays quiet', () => {
  // We cannot tell a fresh install from an update, and announcing "updated!"
  // on a brand-new checkout would be a lie the first time anyone sees this.
  const verdict = versionChange({ head: 'aaa' }, null);
  assert.equal(verdict.announce, false);
  assert.equal(verdict.reason, 'first-boot');
});

test('an update a human already ordered is not announced twice', () => {
  const verdict = versionChange({ head: 'bbb' }, { head: 'aaa' }, true);
  assert.equal(verdict.announce, false);
  assert.equal(verdict.reason, 'already-reported');
});

test('no git means no claim about versions', () => {
  assert.equal(versionChange({ head: null }, { head: 'aaa' }).announce, false);
});

test('the announcement names both commits and says the gate passed', () => {
  const text = updateAnnouncement({ from: 'aaa1111', to: 'bbb2222', subject: 'S117: fix hangman' });
  assert.match(text, /aaa1111/);
  assert.match(text, /bbb2222/);
  assert.match(text, /S117: fix hangman/);
  assert.match(text, /test suite had to pass/, 'the gate is the reassuring part');
  assert.doesNotMatch(text, /^#{1,2} /m, 'no H1/H2 — S114');
});

test('a missing commit subject is simply left out', () => {
  const text = updateAnnouncement({ from: 'aaa', to: 'bbb', subject: null });
  assert.match(text, /aaa.*bbb/s);
  assert.doesNotMatch(text, /\n\*\*/);
});

test('the version marker round-trips per guild', () => {
  const guildId = '412334189879230999';
  assert.equal(getSeenVersion(guildId), null);
  rememberVersion(guildId, 'deadbee');
  assert.deepEqual(getSeenVersion(guildId), { head: 'deadbee' });
});

test('the announcer posts into the owner’s channel on a real change', async () => {
  const guildId = '412334189879231001';
  rememberVersion(guildId, 'oldhead');
  const sent = [];
  const channel = { id: DEFAULT_UPDATE_CHANNEL_ID, send: async (p) => (sent.push(p), p) };
  const guild = {
    id: guildId,
    channels: { cache: new Map([[DEFAULT_UPDATE_CHANNEL_ID, channel]]), fetch: async () => channel },
    members: { me: { permissionsIn: () => ({ has: () => true }) } },
  };
  const client = { config: { homeGuildId: guildId }, guilds: { cache: new Map([[guildId, guild]]) } };

  await updateAnnounce.execute(client);

  // getHead() reads the REAL repo here, so the assertion is on the shape of
  // what happened, not on a specific hash: either a change was announced into
  // the right channel, or the head genuinely matched and nothing was said.
  if (sent.length > 0) {
    assert.equal(sent[0].content.includes('oldhead'), true, 'the announcement names the old commit');
    assert.deepEqual(sent[0].allowedMentions, { parse: [] }, 'an update notice must never ping');
  }
  assert.notEqual(getSeenVersion(guildId)?.head, 'oldhead', 'the new version is recorded either way');
});

test('a second boot on the same commit says nothing', async () => {
  const guildId = '412334189879231002';
  const sent = [];
  const channel = { id: DEFAULT_UPDATE_CHANNEL_ID, send: async (p) => (sent.push(p), p) };
  const guild = {
    id: guildId,
    channels: { cache: new Map([[DEFAULT_UPDATE_CHANNEL_ID, channel]]), fetch: async () => channel },
    members: { me: { permissionsIn: () => ({ has: () => true }) } },
  };
  const client = { config: { homeGuildId: guildId }, guilds: { cache: new Map([[guildId, guild]]) } };

  await updateAnnounce.execute(client); // first boot: records, silent
  await updateAnnounce.execute(client); // same commit: still silent
  assert.deepEqual(sent, [], 'restarts must not spam the channel');
});

// ── S120: the updater diagnosis stops guessing ───────────────────────────────
//
// `!update` used to time out after 3 minutes and announce "the updater never
// ran". It knew no such thing — it had only observed that HEAD had not moved.
// On a Pi, npm install plus 1,087 tests takes longer than that, so a healthy
// update in progress was reported as a broken one and the owner was sent to
// re-run setup-pi.sh for nothing.

const unit = (over = {}) => ({
  known: true,
  loaded: true,
  active: 'inactive',
  result: 'success',
  lastRun: 'Sat 2026-07-26 10:00:00 UTC',
  running: false,
  ...over,
});

test('an update still running is reported as running, not as broken', () => {
  const text = stalledUpdateReport(unit({ active: 'activating', running: true }), 2, 12);
  assert.match(text, /running right now/);
  assert.doesNotMatch(text, /setup-pi/, 'do not send someone to reinstall a working updater');
});

test('a missing service is named as missing, and that IS a setup-pi job', () => {
  const text = stalledUpdateReport(unit({ loaded: false }), 2, 12);
  assert.match(text, /not installed/);
  assert.match(text, /setup-pi\.sh/);
});

test('a failed last run points at the journal, not at reinstalling', () => {
  const text = stalledUpdateReport(unit({ result: 'exit-code' }), 2, 12);
  assert.match(text, /failed/);
  assert.match(text, /journalctl/);
  assert.doesNotMatch(text, /setup-pi/);
});

test('an installed, healthy, idle updater is reported as "has not fired yet"', () => {
  // The likeliest state of all, and the one the old message got most wrong:
  // the timer runs every 15 minutes, so "behind" is normal for a while.
  const text = stalledUpdateReport(unit(), 2, 12);
  assert.match(text, /has not fired yet|not fired/);
  assert.match(text, /15 minutes/);
  assert.doesNotMatch(text, /never ran/, 'the claim it could never support');
});

test('when systemd cannot be queried at all, it says so instead of inventing a cause', () => {
  const text = stalledUpdateReport({ known: false, loaded: false, running: false }, 2, 12);
  assert.match(text, /cannot query systemd/);
});

test('every branch names the number of commits behind', () => {
  for (const u of [unit(), unit({ loaded: false }), unit({ result: 'timeout' }), { known: false, running: false }]) {
    assert.match(stalledUpdateReport(u, 7, 12), /7 commit/);
  }
});

test('updaterUnitStatus parses systemctl show, and survives it being absent', () => {
  const ok = updaterUnitStatus(() => ({
    status: 0,
    stdout: 'LoadState=loaded\nActiveState=activating\nResult=success\nExecMainStartTimestamp=Sat 2026-07-26 10:00:00 UTC\n',
  }));
  assert.equal(ok.loaded, true);
  assert.equal(ok.running, true, 'a Type=oneshot unit is "activating" while it runs');
  assert.equal(ok.lastRun, 'Sat 2026-07-26 10:00:00 UTC');

  const missing = updaterUnitStatus(() => ({ status: 1, stdout: '' }));
  assert.equal(missing.known, false);
  assert.equal(missing.running, false);
});

test('an unloaded unit is reported unloaded, not merely idle', () => {
  const gone = updaterUnitStatus(() => ({
    status: 0,
    stdout: 'LoadState=not-found\nActiveState=inactive\nResult=success\nExecMainStartTimestamp=\n',
  }));
  assert.equal(gone.known, true);
  assert.equal(gone.loaded, false);
  assert.equal(gone.lastRun, null, 'an empty timestamp is not a timestamp');
});
