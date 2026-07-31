// The boot voice sweep (S136).
//
// The defect: the bot restarts itself on every merged PR (S127), live voice
// sessions are RAM-only, and auto-join only fires when a human ENTERS a
// channel — so every self-update killed a running transcription and nothing
// ever brought it back. Discord kept showing the bot in the voice channel
// (its voice state outlives a dead process), which turned a silent death into
// a visible lie. Owner: "Waarom werkt de transcribe niet, de bot is wel in
// het kanaal."
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-resume-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const { resumePlan } = await import('../src/modules/transcribe/lib/pairing.js');
const { resumeSweep } = await import('../src/modules/transcribe/events/ready.js');
const { gracefulExit } = await import('../src/modules/core/updater.js');

const CONFIG = { enabled: true, autoJoin: true, autoJoinMinimum: 1 };

// ── the pure decision ────────────────────────────────────────────────────────

test('a lingering voice state with people present RESUMES', () => {
  const plan = resumePlan({
    lingering: { channelId: 'vc-1', humans: 2 },
    channels: [{ id: 'vc-1', humans: 2 }],
    config: CONFIG,
    hasKey: true,
  });
  assert.deepEqual(plan, { action: 'resume', channelId: 'vc-1' });
});

test('a lingering state resumes even when autoJoin is OFF — the presence IS the record', () => {
  // The session may have been a manual `!transcribe join`; the bot's own
  // voice state is the persistence of that decision.
  const plan = resumePlan({
    lingering: { channelId: 'vc-1', humans: 1 },
    channels: [],
    config: { ...CONFIG, autoJoin: false },
    hasKey: true,
  });
  assert.equal(plan.action, 'resume');
});

test('a lingering state in an EMPTY channel disconnects — no ghost in the room', () => {
  const plan = resumePlan({
    lingering: { channelId: 'vc-1', humans: 0 },
    channels: [{ id: 'vc-1', humans: 0 }],
    config: CONFIG,
    hasKey: true,
  });
  assert.deepEqual(plan, { action: 'disconnect', channelId: 'vc-1' });
});

test('a lingering state with no key or module disabled disconnects rather than sitting mute', () => {
  for (const args of [
    { config: CONFIG, hasKey: false },
    { config: { ...CONFIG, enabled: false }, hasKey: true },
  ]) {
    const plan = resumePlan({
      lingering: { channelId: 'vc-1', humans: 3 },
      channels: [],
      ...args,
    });
    assert.equal(plan.action, 'disconnect', JSON.stringify(args));
  }
});

test('no lingering state: people already sitting in a channel get joined at boot', () => {
  // They will never re-trigger auto-join by entering — they are already in.
  const plan = resumePlan({
    lingering: null,
    channels: [
      { id: 'vc-a', humans: 1 },
      { id: 'vc-b', humans: 3 },
    ],
    config: CONFIG,
    hasKey: true,
  });
  assert.deepEqual(plan, { action: 'join', channelId: 'vc-b' }, 'the fullest room wins');
});

test('no lingering state: the ordinary auto-join gate still applies', () => {
  const off = resumePlan({ lingering: null, channels: [{ id: 'v', humans: 2 }], config: { ...CONFIG, autoJoin: false }, hasKey: true });
  assert.equal(off.action, 'none');
  const scoped = resumePlan({
    lingering: null,
    channels: [{ id: 'v', humans: 2 }],
    config: { ...CONFIG, voiceChannelIds: ['other'] },
    hasKey: true,
  });
  assert.equal(scoped.action, 'none');
  const noKey = resumePlan({ lingering: null, channels: [{ id: 'v', humans: 2 }], config: CONFIG, hasKey: false });
  assert.deepEqual(noKey, { action: 'none', reason: 'no-key' });
  const empty = resumePlan({ lingering: null, channels: [{ id: 'v', humans: 0 }], config: CONFIG, hasKey: true });
  assert.deepEqual(empty, { action: 'none', reason: 'nobody' });
});

// ── the sweep wiring ─────────────────────────────────────────────────────────

const human = (id) => ({ id, user: { bot: false } });

/** A guild whose voice picture is exactly what the test says it is. */
function fakeGuild({ botIn = null, channels = [] } = {}) {
  const disconnects = [];
  const sends = [];
  const cache = new Map();
  for (const spec of channels) {
    cache.set(spec.id, {
      id: spec.id,
      name: spec.name ?? spec.id,
      parentId: null,
      isVoiceBased: () => true,
      isTextBased: () => true,
      members: new Map(spec.humans.map((h) => [h.id, h])),
      permissionsFor: () => ({ has: () => true }),
      send: async (p) => sends.push(p),
      toString: () => `<#${spec.id}>`,
    });
  }
  return {
    id: `95${String(Math.trunc(1e15 * 0.5))}`,
    disconnects,
    sends,
    channels: { cache },
    members: {
      me: {
        voice: {
          channel: botIn ? cache.get(botIn) : null,
          disconnect: async () => disconnects.push(botIn),
        },
      },
    },
  };
}

test('the sweep disconnects a ghost: bot lingering in an empty channel', async () => {
  const guild = fakeGuild({ botIn: 'vc-1', channels: [{ id: 'vc-1', humans: [] }] });
  guild.id = '950000000000000001';
  const started = [];
  const result = await resumeSweep(guild, { start: async () => (started.push(1), { ok: true }), key: () => true });
  assert.equal(result.action, 'disconnect');
  assert.deepEqual(guild.disconnects, ['vc-1'], 'the stale voice state was not cleared');
  assert.equal(started.length, 0);
});

test('the sweep resumes into the channel the bot lingers in, and announces it', async () => {
  const guild = fakeGuild({ botIn: 'vc-2', channels: [{ id: 'vc-2', humans: [human('u1')] }] });
  guild.id = '950000000000000002';
  const started = [];
  const result = await resumeSweep(guild, {
    start: async (g, voice, text) => (started.push({ voice: voice.id, text: text.id }), { ok: true }),
    key: () => true,
  });
  assert.equal(result.action, 'resume');
  assert.deepEqual(started, [{ voice: 'vc-2', text: 'vc-2' }], 'no paired text channel → its own built-in chat');
  assert.match(guild.sends[0].content, /Recording/, 'the room must be told, unprompted');
  assert.match(guild.sends[0].content, /restarted/, 'and told WHY the bot is back');
  assert.deepEqual(guild.sends[0].allowedMentions, { parse: [] });
});

test('the sweep joins people already sitting in a channel at boot', async () => {
  const guild = fakeGuild({
    botIn: null,
    channels: [
      { id: 'vc-a', humans: [human('u1')] },
      { id: 'vc-b', humans: [human('u2'), human('u3')] },
    ],
  });
  guild.id = '950000000000000003';
  const started = [];
  const result = await resumeSweep(guild, {
    start: async (g, voice) => (started.push(voice.id), { ok: true }),
    key: () => true,
  });
  assert.equal(result.action, 'join');
  assert.deepEqual(started, ['vc-b'], 'the fullest room wins');
});

test('a failed start is reported, not celebrated', async () => {
  const guild = fakeGuild({ botIn: 'vc-1', channels: [{ id: 'vc-1', humans: [human('u1')] }] });
  guild.id = '950000000000000004';
  const result = await resumeSweep(guild, { start: async () => ({ ok: false, reason: 'join-failed' }), key: () => true });
  assert.deepEqual(result, { action: 'none', reason: 'join-failed' });
  assert.equal(guild.sends.length, 0, 'no announcement for a session that did not start');
});

// ── the graceful exit ────────────────────────────────────────────────────────

test('gracefulExit runs every module shutdown hook, destroys the client, then exits', async () => {
  const order = [];
  const client = {
    moduleShutdowns: [
      { name: 'a', run: async () => order.push('hook-a') },
      { name: 'b', run: () => order.push('hook-b') },
    ],
    destroy: async () => order.push('destroy'),
  };
  await gracefulExit(client, { exitFn: () => order.push('exit') });
  assert.deepEqual(order, ['hook-a', 'hook-b', 'destroy', 'exit']);
});

test('a hanging shutdown hook cannot hold the restart hostage', async () => {
  const order = [];
  const client = {
    moduleShutdowns: [{ name: 'stuck', run: () => new Promise(() => {}) }],
    destroy: async () => order.push('destroy'),
  };
  await gracefulExit(client, { exitFn: () => order.push('exit'), timeoutMs: 50 });
  assert.deepEqual(order, ['destroy', 'exit'], 'the bound must win over the hook');
});

test('a throwing hook and a missing client still reach the exit', async () => {
  const order = [];
  await gracefulExit(
    { moduleShutdowns: [{ name: 'bad', run: () => { throw new Error('boom'); } }] },
    { exitFn: () => order.push('exit') },
  );
  assert.deepEqual(order, ['exit']);
  // No client at all (crash-early path): still exits rather than throwing.
  await gracefulExit(null, { exitFn: () => order.push('exit-2') });
  assert.deepEqual(order, ['exit', 'exit-2']);
});

// ── the loader hook collection ───────────────────────────────────────────────

test('the loader collects the transcribe shutdown hook by name', async () => {
  // Through the REAL loader, not an import of the manifest: what matters is
  // that the wired client ends up holding the hook (S133's lesson — a file
  // existing is not the same fact as the bot having the behavior).
  const { loadModules } = await import('../src/core/loader.js');
  const handlers = [];
  const client = {
    on: (...a) => handlers.push(a),
    once: (...a) => handlers.push(a),
  };
  await loadModules(client);
  const names = client.moduleShutdowns.map((h) => h.name);
  assert.ok(names.includes('transcribe'), `no transcribe shutdown hook; got: ${names.join(', ') || 'none'}`);
  for (const hook of client.moduleShutdowns) assert.equal(typeof hook.run, 'function');
});
