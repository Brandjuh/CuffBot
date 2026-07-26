// Dispatch command smokes. S95 (M17.3 slice C) moved them onto
// `dispatchCommand` — the router's own path — instead of hand-built
// interactions, so the permission gate and the `action:` keyword are covered
// rather than simulated.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import dispatchGroupCmd from '../src/modules/dispatch/commands/dispatch.js';

// S106: `!evidence-locker` is `!dispatch locker`, and announcing is `send`.
const evidenceLocker = { group: dispatchGroupCmd.group, sub: 'locker' };
const dispatch = { group: dispatchGroupCmd.group, sub: 'send' };
import { getEvidenceLocker } from '../src/modules/dispatch/lib/api.js';
import { dispatchCommand } from '../src/core/prefix/command.js';
import { dispatchGroup } from '../src/core/prefix/group.js';
import { fakeMessage } from './fixtures/fake-message.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-dispatch-cmd-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';

/**
 * S106: the hyphenated commands became subcommands, so a test that used to
 * dispatch a flat command now dispatches its GROUP with the subcommand name in
 * front. `sub(group, 'name')` names that pair; the local `run` helper below
 * takes either shape, so the dispatch stays real (S93's rule).
 */
const sub = (groupCmd, name) => ({ group: groupCmd.group, sub: name });

async function run(command, tokens, { perms = true, channelId = 'chan-1' } = {}) {
  const message = fakeMessage({ perms, guildId: GUILD });
  const channelSends = [];
  message.channel.id = channelId;
  message.channel.toString = () => `<#${channelId}>`;
  const originalSend = message.channel.send;
  message.channel.send = async (p) => {
    channelSends.push(p);
    return originalSend(p);
  };
  const outcome = command.sub
    ? await dispatchGroup(command.group, message, [command.sub, ...tokens], '!')
    : await dispatchCommand(command.command, message, tokens, '!');
  return { outcome, sent: message.sent, channelSends };
}

test('evidence-locker requires Manage Server', async () => {
  const { outcome, sent } = await run(evidenceLocker, ['set'], { perms: false });
  assert.equal(outcome, 'refused');
  assert.match(sent[0].content, /Manage Server/);
});

test('evidence-locker set stores the current channel; status reports it; clear removes it', async () => {
  const set = await run(evidenceLocker, ['set'], { channelId: 'log-chan' });
  assert.equal(getEvidenceLocker(GUILD), 'log-chan');
  assert.match(set.sent[0].content, /set to/i);

  const status = await run(evidenceLocker, ['status']);
  assert.match(status.sent[0].content, /log-chan/);

  const cleared = await run(evidenceLocker, ['clear']);
  assert.equal(getEvidenceLocker(GUILD), null);
  assert.match(cleared.sent[0].content, /cleared/i);
});

test('evidence-locker takes the documented action: keyword form (S94/S95)', async () => {
  // `!evidence-locker action:set` is what the dispatch manual, the
  // public-affairs manual and !911's own reply all tell people to type.
  const set = await run(evidenceLocker, ['action:set'], { channelId: 'kw-chan' });
  assert.equal(set.outcome, 'ran');
  assert.equal(getEvidenceLocker(GUILD), 'kw-chan');
  await run(evidenceLocker, ['action:clear']);
  assert.equal(getEvidenceLocker(GUILD), null);
});

test('evidence-locker refuses an action outside the three it knows', async () => {
  const { outcome, sent } = await run(evidenceLocker, ['action:destroy']);
  assert.equal(outcome, 'usage-error');
  assert.match(sent[0].content, /`action` must be one of: status, set, clear/);
});

test('evidence-locker status with nothing configured explains how to set it', async () => {
  const { sent } = await run(evidenceLocker, []); // defaults to status
  assert.match(sent[0].content, /No evidence locker configured/);
});

test('dispatch posts an announcement embed into the channel', async () => {
  const { channelSends } = await run(dispatch, ['All', 'units,', 'code', '3.']);
  assert.equal(channelSends.length, 1);
  assert.equal(channelSends[0].embeds[0].description, 'All units, code 3.');
});

test('dispatch requires Manage Messages', async () => {
  const { outcome, sent, channelSends } = await run(dispatch, ['hi'], { perms: false });
  assert.equal(outcome, 'refused');
  assert.match(sent[0].content, /Manage Messages/);
  assert.equal(channelSends.length, 0);
});

test('dispatch without a message is a usage error, not an empty announcement', async () => {
  const { outcome, sent, channelSends } = await run(dispatch, []);
  assert.equal(outcome, 'usage-error');
  assert.match(sent[0].content, /missing `message`/);
  assert.equal(channelSends.length, 0);
});
