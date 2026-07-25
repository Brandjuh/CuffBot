// Heist slice C (S87 = M16.12, maxcogs port): the scheduler that makes a
// finished job announce itself, and the boot catch-up that re-arms whatever
// was running when the bot stopped.
//
// NOTE (S73/S81 rule, architecture.md): the timers here are unref'd, so any
// test that genuinely waits for one needs an explicit event-loop keep-alive
// or node:test cancels the file with "Promise resolution is still pending".
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { Events } from 'discord.js';
import { HEISTS } from '../src/modules/heist/lib/tables.js';
import { getPlayer, startHeist, updatePlayer } from '../src/modules/heist/service.js';
import {
  armHeistTimer,
  armedHeistCount,
  cancelHeistTimer,
  clearAllHeistTimers,
  fireHeist,
  rearmAllHeists,
} from '../src/modules/heist/scheduler.js';
import readyEvent from '../src/modules/heist/events/ready.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-heist-sched-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
  clearAllHeistTimers();
});

const NOW = 1_800_000_000_000;
let seq = 0;
const freshGuildId = () => `87000000000000${String((seq += 1)).padStart(4, '0')}`;

/** A client stub: one guild, one channel, recording every send. */
function fakeClient(guildId, { channelId = 'chan', channelMissing = false, sendThrows = false } = {}) {
  const sent = [];
  const channel = {
    id: channelId,
    send: async (payload) => {
      if (sendThrows) throw new Error('missing permissions');
      sent.push(payload);
      return { id: 'msg' };
    },
  };
  return {
    sent,
    channels: {
      cache: new Map(channelMissing ? [] : [[channelId, channel]]),
      fetch: async () => null,
    },
    guilds: {
      cache: new Map([[guildId, { id: guildId, members: { fetch: async () => ({ displayName: 'Officer Alice' }) } }]]),
    },
  };
}

const waitFor = async (predicate, timeoutMs = 2000) => {
  // The keep-alive the unref'd timers need — cleared in the finally.
  const keepAlive = setInterval(() => {}, 20);
  try {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return false;
  } finally {
    clearInterval(keepAlive);
  }
};

// ── firing ───────────────────────────────────────────────────────────────────

test('firing a due job settles it and announces it with a scoped ping', async () => {
  const guildId = freshGuildId();
  const client = fakeClient(guildId);
  startHeist(guildId, 'alice', 'atm_smash', 'chan', { now: NOW });
  const done = NOW + HEISTS.atm_smash.durationMs;

  const outcome = await fireHeist(client, guildId, 'alice', { now: done });
  assert.ok(outcome, 'it settled');
  assert.equal(client.sent.length, 1);
  const payload = client.sent[0];
  assert.equal(payload.content, '<@alice>');
  assert.deepEqual(payload.allowedMentions, { users: ['alice'] }, 'only the job owner is pinged');
  assert.match(payload.embeds[0].toJSON().title, /Atm Smash/);
  assert.equal(getPlayer(guildId, 'alice', done).activeHeist, null, 'the job is cleared');
});

test('a vanished channel leaves the job for the lazy path instead of losing it', async () => {
  const guildId = freshGuildId();
  const client = fakeClient(guildId, { channelMissing: true });
  startHeist(guildId, 'alice', 'atm_smash', 'chan', { now: NOW });
  const done = NOW + HEISTS.atm_smash.durationMs;

  assert.equal(await fireHeist(client, guildId, 'alice', { now: done }), null);
  assert.equal(client.sent.length, 0);
  assert.ok(getPlayer(guildId, 'alice', done).activeHeist, 'the record survives — the next command will report it');
});

test('a send that fails still settles: the state is applied, the loss is only the message', async () => {
  const guildId = freshGuildId();
  const client = fakeClient(guildId, { sendThrows: true });
  startHeist(guildId, 'alice', 'atm_smash', 'chan', { now: NOW });
  const done = NOW + HEISTS.atm_smash.durationMs;

  const outcome = await fireHeist(client, guildId, 'alice', { now: done });
  assert.ok(outcome, 'settled despite the failed send');
  assert.equal(getPlayer(guildId, 'alice', done).activeHeist, null);
});

test('firing with nothing running is a no-op', async () => {
  const guildId = freshGuildId();
  const client = fakeClient(guildId);
  assert.equal(await fireHeist(client, guildId, 'nobody', { now: NOW }), null);
  assert.equal(client.sent.length, 0);
});

// ── arming ───────────────────────────────────────────────────────────────────

test('an armed timer fires on its own once the clock runs out', async () => {
  const guildId = freshGuildId();
  const client = fakeClient(guildId);
  // Backdate the start so the job is already due; the timer only has to fire.
  startHeist(guildId, 'alice', 'vending_machine', 'chan', { now: Date.now() - HEISTS.vending_machine.durationMs - 1000 });
  armHeistTimer(client, guildId, 'alice', Date.now() + 30);
  assert.equal(armedHeistCount(), 1);

  const fired = await waitFor(() => client.sent.length === 1);
  assert.ok(fired, 'the timer announced the result without being asked');
  assert.equal(armedHeistCount(), 0, 'and disarmed itself');
});

test('re-arming replaces the timer — a job can never announce twice', async () => {
  const guildId = freshGuildId();
  const client = fakeClient(guildId);
  startHeist(guildId, 'alice', 'vending_machine', 'chan', { now: Date.now() - HEISTS.vending_machine.durationMs - 1000 });
  armHeistTimer(client, guildId, 'alice', Date.now() + 20);
  armHeistTimer(client, guildId, 'alice', Date.now() + 25);
  armHeistTimer(client, guildId, 'alice', Date.now() + 30);
  assert.equal(armedHeistCount(), 1, 'only the newest survives');

  assert.ok(await waitFor(() => client.sent.length >= 1));
  // Give the two cancelled timers well past their deadline to misbehave.
  await waitFor(() => false, 60);
  assert.equal(client.sent.length, 1, 'exactly one announcement');
});

test('cancelling an armed timer keeps it quiet', async () => {
  const guildId = freshGuildId();
  const client = fakeClient(guildId);
  startHeist(guildId, 'alice', 'vending_machine', 'chan', { now: Date.now() - HEISTS.vending_machine.durationMs - 1000 });
  armHeistTimer(client, guildId, 'alice', Date.now() + 20);
  cancelHeistTimer(guildId, 'alice');
  assert.equal(armedHeistCount(), 0);
  await waitFor(() => false, 60);
  assert.equal(client.sent.length, 0, 'nothing was announced');
  assert.ok(getPlayer(guildId, 'alice').activeHeist, 'the job is still there for the lazy path');
});

// ── boot catch-up ────────────────────────────────────────────────────────────

test('boot re-arms running jobs and settles the ones that finished while offline', async () => {
  const guildId = freshGuildId();
  const client = fakeClient(guildId);
  // One job that ended during the downtime…
  updatePlayer(guildId, 'overdue', (p) => ({
    ...p,
    activeHeist: { type: 'atm_smash', endsAt: NOW - 60_000, channelId: 'chan', taxAgreed: false },
  }), NOW);
  // …one still running…
  updatePlayer(guildId, 'running', (p) => ({
    ...p,
    activeHeist: { type: 'bank', endsAt: NOW + 600_000, channelId: 'chan', taxAgreed: false },
  }), NOW);
  // …and someone with no job at all.
  updatePlayer(guildId, 'idle', (p) => ({ ...p, xp: 10 }), NOW);

  const result = await rearmAllHeists(client, { now: NOW });
  assert.deepEqual(result, { armed: 1, fired: 1 });
  assert.equal(client.sent.length, 1, 'the overdue job announced itself');
  assert.equal(client.sent[0].content, '<@overdue>');
  assert.equal(getPlayer(guildId, 'overdue', NOW).activeHeist, null, 'settled');
  assert.ok(getPlayer(guildId, 'running', NOW).activeHeist, 'the running one is untouched');
  assert.equal(armedHeistCount(), 1, 'and armed');
  clearAllHeistTimers();
});

test('boot with no stored jobs arms nothing', async () => {
  const guildId = freshGuildId();
  const client = fakeClient(guildId);
  assert.deepEqual(await rearmAllHeists(client, { now: NOW }), { armed: 0, fired: 0 });
  assert.equal(armedHeistCount(), 0);
});

test('the ready event is a once-listener that survives a failing re-arm', async () => {
  assert.equal(readyEvent.name, Events.ClientReady, "discord.js v14 calls it 'clientReady'");
  assert.equal(readyEvent.once, true);
  // A client with no guilds cache at all must not throw out of the listener.
  await readyEvent.execute({});
});
