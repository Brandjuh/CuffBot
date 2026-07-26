// Patrol command smokes. S95 (M17.3 slice C) moved them onto
// `dispatchCommand`, so the permission gate and the `choices` validation are
// covered rather than simulated — and the previously untested `!patrol-wizard`
// is exercised too (it had been dead since S68).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import patrolGroup from '../src/modules/patrol/commands/patrol.js';

// S106: `!patrol-rule` / `-term` / `-wizard` are subcommands now.
const patrol = { group: patrolGroup.group, sub: 'status' };
const patrolRule = { group: patrolGroup.group, sub: 'rule' };
const patrolTerm = { group: patrolGroup.group, sub: 'term' };
const patrolWizard = { group: patrolGroup.group, sub: 'wizard' };

import { getPatrolConfig, getWizardDraft } from '../src/modules/patrol/service.js';
import { dispatchCommand } from '../src/core/prefix/command.js';
import { dispatchGroup } from '../src/core/prefix/group.js';
import { fakeMessage } from './fixtures/fake-message.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-patrol-cmd-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

const GUILD = '411157175948541954';
const ADMIN = '111000000000000111';

/**
 * S106: the hyphenated commands became subcommands, so a test that used to
 * dispatch a flat command now dispatches its GROUP with the subcommand name in
 * front. `sub(group, 'name')` names that pair; the local `run` helper below
 * takes either shape, so the dispatch stays real (S93's rule).
 */
const sub = (groupCmd, name) => ({ group: groupCmd.group, sub: name });

async function run(command, tokens, { perms = true, contentIntent = true } = {}) {
  const message = fakeMessage({ perms, guildId: GUILD, authorId: ADMIN });
  message.client.messageContentAvailable = contentIntent;
  const outcome = command.sub
    ? await dispatchGroup(command.group, message, [command.sub, ...tokens], '!')
    : await dispatchCommand(command.command, message, tokens, '!');
  return { outcome, sent: message.sent };
}

const descOf = (reply) => reply.embeds[0].data?.description ?? reply.embeds[0].description;

test('patrol requires Manage Server', async () => {
  const { outcome, sent } = await run(patrol, ['on'], { perms: false });
  assert.equal(outcome, 'refused');
  assert.match(sent[0].content, /Manage Server/);
});

test('patrol on/off flips the stored flag and status shows it', async () => {
  await run(patrol, ['on']);
  assert.equal(getPatrolConfig(GUILD).enabled, true);

  const status = await run(patrol, []);
  assert.match(descOf(status.sent[0]), /Patrol:.*on/);

  await run(patrol, ['off']);
  assert.equal(getPatrolConfig(GUILD).enabled, false);
});

test('patrol refuses an action outside status/on/off', async () => {
  const { outcome, sent } = await run(patrol, ['maybe']);
  assert.equal(outcome, 'usage-error');
  assert.match(sent[0].content, /`action` must be one of: status, on, off/);
});

test('patrol warns when the Message Content intent is off', async () => {
  const { sent } = await run(patrol, [], { contentIntent: false });
  const embed = sent[0].embeds[0];
  const fields = embed.data?.fields ?? embed.fields ?? [];
  assert.ok(fields.some((f) => /Message Content/.test(f.name)));
});

test('patrol-rule toggles a category', async () => {
  const { sent } = await run(patrolRule, ['invites', 'off']);
  assert.equal(getPatrolConfig(GUILD).rules.invites, false);
  assert.match(sent[0].content, /Invite links.*off/);
});

test('patrol-rule refuses an unknown rule by name, before run() is entered', async () => {
  const { outcome, sent } = await run(patrolRule, ['telepathy', 'off']);
  assert.equal(outcome, 'usage-error');
  assert.match(sent[0].content, /`rule` must be one of: bannedTerms, invites, spam/);
});

test('patrol-term adds and removes without echoing the term', async () => {
  const add = await run(patrolTerm, ['add', 'BadWord']);
  assert.ok(getPatrolConfig(GUILD).bannedTerms.includes('badword'));
  // S95: the reply lands in a public channel (no ephemerals on the text path
  // since S54), so repeating the term would post the very word being banned.
  assert.doesNotMatch(add.sent[0].content, /badword/i);

  const remove = await run(patrolTerm, ['remove', 'badword']);
  assert.ok(!getPatrolConfig(GUILD).bannedTerms.includes('badword'));
  assert.doesNotMatch(remove.sent[0].content, /badword/i);
});

test('patrol-term takes a multi-word phrase as one term', async () => {
  await run(patrolTerm, ['add', 'Very', 'Bad', 'Phrase']);
  assert.ok(getPatrolConfig(GUILD).bannedTerms.includes('very bad phrase'));
  await run(patrolTerm, ['remove', 'very bad phrase']);
  assert.ok(!getPatrolConfig(GUILD).bannedTerms.includes('very bad phrase'));
});

// ── the wizard, alive again (S95) ────────────────────────────────────────────
// It refused to run as a text command, and S68 made every invocation one — so
// from S68 until S95 it answered nothing but "being rebuilt for text-only mode".

test('patrol-wizard posts the overview and opens a draft seeded from live config', async () => {
  await run(patrol, ['on']);
  const { outcome, sent } = await run(patrolWizard, []);
  assert.equal(outcome, 'ran');
  assert.ok(sent[0].embeds?.length, 'the overview is an embed');
  assert.ok(sent[0].components?.length, 'with components to press');

  const draft = getWizardDraft(GUILD, ADMIN);
  assert.ok(draft, 'a draft exists for the admin who ran it');
  assert.deepEqual(draft.rules, getPatrolConfig(GUILD).rules, 'seeded from the live config');
});

test('patrol-wizard is gated on Manage Server', async () => {
  const { outcome, sent } = await run(patrolWizard, [], { perms: false });
  assert.equal(outcome, 'refused');
  assert.match(sent[0].content, /Manage Server/);
});
