// S93 (M17.3 slice A): these used to call execute() with a hand-built
// interaction. They now go through dispatchCommand — the same path the router
// takes — so the permission gate, the arg resolution and the reply are all
// covered by the test rather than simulated by it.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import rapsheet from '../src/modules/records/commands/rapsheet.js';
import expunge from '../src/modules/records/commands/expunge.js';
import { addRecord } from '../src/modules/records/lib/api.js';
import { dispatchCommand } from '../src/core/prefix/command.js';
import { fakeMessage, fakeUser } from './fixtures/fake-message.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-recsheet-test-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';
// Real snowflakes: the `user` arg type only accepts a mention or a 15-21 digit
// id, exactly like Discord — short test ids would be rejected on arrival.
const PERP = '700000000000000005';
const PERP2 = '700000000000000006';
const SAINT = '700000000000000007';

/** Run a flat command with `perp` mentioned, returning the recorded replies. */
async function run(command, tokens, { perms = true, perp = fakeUser(PERP, 'perp') } = {}) {
  const message = fakeMessage({ perms, guildId: GUILD, users: { [perp.id]: perp } });
  const outcome = await dispatchCommand(command.command, message, tokens, '!');
  return { outcome, sent: message.sent, perp };
}

test('rapsheet: blocked without Moderate Members — and names THAT permission', async () => {
  const { outcome, sent } = await run(rapsheet, [PERP], { perms: false });
  assert.equal(outcome, 'refused');
  // Before S93 every refusal said "Manage Server", whatever the gate was.
  assert.match(sent[0].content, /Moderate Members/);
});

test('rapsheet: clean sheet reads as clean', async () => {
  const saint = fakeUser(SAINT, 'saint');
  const { sent } = await run(rapsheet, [SAINT], { perp: saint });
  assert.match(sent[0].content, /Clean sheet/);
});

test('rapsheet: shows filed records', async () => {
  addRecord(GUILD, { type: 'citation', userId: PERP, officerId: '111', reason: 'spam' });
  addRecord(GUILD, { type: 'arrest', userId: PERP, officerId: '111', reason: 'worse spam' });
  const { sent } = await run(rapsheet, [PERP]);
  assert.match(sent[0].content, /RAP SHEET — PERP/);
  assert.match(sent[0].content, /1 citation/);
  assert.match(sent[0].content, /1 arrest/);
  // S54: a text command answers in-channel and pings nobody — no ephemeral flag.
  assert.equal(sent[0].via, 'reply');
  assert.deepEqual(sent[0].allowedMentions, { repliedUser: false });
});

test('rapsheet: missing target is a usage error, not a crash', async () => {
  const { outcome, sent } = await run(rapsheet, []);
  assert.equal(outcome, 'usage-error');
  assert.match(sent[0].content, /missing `target`/);
  assert.match(sent[0].content, /!rapsheet <target>/);
});

test('expunge: demands Manage Server, not just moderation', async () => {
  const { outcome, sent } = await run(expunge, [PERP], { perms: false });
  assert.equal(outcome, 'refused');
  assert.match(sent[0].content, /Manage Server/);
});

test('expunge: erases one case, then reports a clean miss', async () => {
  const perp = fakeUser(PERP2, 'perp');
  addRecord(GUILD, { type: 'citation', userId: PERP2, officerId: '111', reason: 'jaywalking' });
  const filed = addRecord(GUILD, {
    type: 'citation',
    userId: PERP2,
    officerId: '111',
    reason: 'double parking',
  });

  const one = await run(expunge, [PERP2, String(filed.caseNumber)], { perp });
  assert.match(one.sent[0].content, new RegExp(`Case #${filed.caseNumber} expunged`));

  const again = await run(expunge, [PERP2, String(filed.caseNumber)], { perp });
  assert.match(again.sent[0].content, /Nothing expunged/);

  const all = await run(expunge, [PERP2], { perp });
  assert.match(all.sent[0].content, /1 record\(s\) erased/);
});

test('expunge: case 0 is refused by the arg spec, not by the command body', async () => {
  const { outcome, sent } = await run(expunge, [PERP, '0']);
  assert.equal(outcome, 'usage-error');
  assert.match(sent[0].content, /`case` must be at least 1/);
});
