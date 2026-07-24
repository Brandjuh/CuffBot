import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  RULE_CHOICES,
  applyRuleSelection,
  parseTermsInput,
  summarizeDraft,
} from '../src/modules/patrol/lib/wizard.js';
import {
  clearWizardDraft,
  getPatrolConfig,
  getWizardDraft,
  startWizardDraft,
} from '../src/modules/patrol/service.js';
import wizardPump from '../src/modules/patrol/events/wizard.js';
import patrolWizard from '../src/modules/patrol/commands/patrol-wizard.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-patrol-wizard-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `50000000000000${String((seq += 1)).padStart(4, '0')}`;

// ── pure wizard logic ────────────────────────────────────────────────────────

test('parseTermsInput splits, trims, dedupes, and clamps', () => {
  assert.deepEqual(parseTermsInput('badword, Another Term\nthird;  ,, BADWORD '), [
    'badword',
    'Another Term',
    'third',
  ]);
  assert.deepEqual(parseTermsInput(''), []);
  assert.equal(parseTermsInput(Array.from({ length: 150 }, (_, i) => `t${i}`).join(',')).length, 100);
  assert.equal(parseTermsInput('x'.repeat(200))[0].length, 64);
});

test('applyRuleSelection maps the multi-select onto the rule flags', () => {
  const draft = { rules: { bannedTerms: true, invites: true, spam: true }, bannedTerms: [] };
  const next = applyRuleSelection(draft, ['invites']);
  assert.deepEqual(next.rules, { bannedTerms: false, invites: true, spam: false });
  assert.deepEqual(applyRuleSelection(draft, []).rules, {
    bannedTerms: false,
    invites: false,
    spam: false,
  });
});

test('summarizeDraft shows toggles and an honest terms line', () => {
  const on = summarizeDraft({ rules: { bannedTerms: true, invites: true, spam: false }, bannedTerms: [] });
  assert.equal(on.length, RULE_CHOICES.length + 1);
  assert.match(on.at(-1), /stays dormant/);
  const withTerms = summarizeDraft({
    rules: { bannedTerms: true, invites: true, spam: true },
    bannedTerms: Array.from({ length: 12 }, (_, i) => `term${i}`),
  });
  assert.match(withTerms.at(-1), /12 banned term/);
  assert.match(withTerms.at(-1), /…/, 'long lists are previewed, not dumped');
});

test('wizard drafts expire after the TTL', () => {
  const guildId = freshGuildId();
  startWizardDraft(guildId, 'admin', { rules: {}, bannedTerms: [] }, { now: 1_000, ttlMs: 100 });
  assert.ok(getWizardDraft(guildId, 'admin', { now: 1_050 }));
  assert.equal(getWizardDraft(guildId, 'admin', { now: 1_100 }), null, 'expired and removed');
  assert.equal(getWizardDraft(guildId, 'admin', { now: 1_050 }), null, 'removal is permanent');
});

// ── the interactive flow, end to end with fakes ──────────────────────────────

function fakeComponent(guild, userId, customId, { values, fields, kind = 'button' } = {}) {
  const state = { updates: [], replies: [], modal: null };
  return {
    state,
    guild,
    user: { id: userId },
    customId,
    values,
    fields: fields ? { getTextInputValue: (name) => fields[name] ?? '' } : undefined,
    isButton: () => kind === 'button',
    isStringSelectMenu: () => kind === 'select',
    isModalSubmit: () => kind === 'modal',
    isFromMessage: () => true,
    update: async (p) => state.updates.push(p),
    reply: async (p) => state.replies.push(p),
    showModal: async (m) => (state.modal = m),
  };
}

const embedText = (payload) => JSON.stringify(payload.embeds.map((e) => e.toJSON?.() ?? e));

test('the full wizard flow: start → pick rules → review → terms modal → enable', async () => {
  const guildId = freshGuildId();
  const guild = { id: guildId };

  // /patrol-wizard seeds the draft and shows the overview.
  const slash = {
    guild,
    user: { id: 'admin' },
    memberPermissions: { has: () => true },
    replies: [],
    reply: async (p) => slash.replies.push(p),
  };
  await patrolWizard.execute(slash);
  assert.match(embedText(slash.replies[0]), /Step 1 of 3/);
  assert.equal(slash.replies[0].flags, 64, 'the wizard is ephemeral');
  assert.ok(getWizardDraft(guildId, 'admin'), 'draft seeded');

  // Start → rules step.
  const start = fakeComponent(guild, 'admin', 'patrol-wizard:start');
  await wizardPump.execute(start);
  assert.match(embedText(start.state.updates[0]), /Step 2 of 3/);

  // Deselect spam via the multi-select.
  const pick = fakeComponent(guild, 'admin', 'patrol-wizard:pick', {
    kind: 'select',
    values: ['bannedTerms', 'invites'],
  });
  await wizardPump.execute(pick);
  assert.equal(getWizardDraft(guildId, 'admin').rules.spam, false);

  // Next → review.
  const next = fakeComponent(guild, 'admin', 'patrol-wizard:next');
  await wizardPump.execute(next);
  assert.match(embedText(next.state.updates[0]), /Step 3 of 3/);

  // Edit terms opens the modal (the interaction's response IS the modal).
  const edit = fakeComponent(guild, 'admin', 'patrol-wizard:edit-terms');
  await wizardPump.execute(edit);
  assert.ok(edit.state.modal, 'modal shown');
  assert.equal(edit.state.updates.length, 0);

  // Modal submit stores the parsed terms and returns to review.
  const modal = fakeComponent(guild, 'admin', 'patrol-wizard:terms-modal', {
    kind: 'modal',
    fields: { terms: 'crook, scoundrel\ncrook' },
  });
  await wizardPump.execute(modal);
  assert.deepEqual(getWizardDraft(guildId, 'admin').bannedTerms, ['crook', 'scoundrel']);
  assert.match(embedText(modal.state.updates[0]), /2 banned term/);

  // Save & enable writes the real config and clears the draft.
  const enable = fakeComponent(guild, 'admin', 'patrol-wizard:enable');
  await wizardPump.execute(enable);
  const saved = getPatrolConfig(guildId);
  assert.equal(saved.enabled, true);
  assert.deepEqual(saved.rules, { bannedTerms: true, invites: true, spam: false });
  assert.deepEqual(saved.bannedTerms, ['crook', 'scoundrel']);
  assert.equal(getWizardDraft(guildId, 'admin'), null, 'draft cleared');
  assert.match(embedText(enable.state.updates[0]), /ON DUTY/);
});

test('save-without-enabling keeps patrol off; cancel saves nothing', async () => {
  const guildId = freshGuildId();
  const guild = { id: guildId };
  startWizardDraft(guildId, 'admin', {
    rules: { bannedTerms: false, invites: true, spam: true },
    bannedTerms: [],
  });
  const save = fakeComponent(guild, 'admin', 'patrol-wizard:save');
  await wizardPump.execute(save);
  assert.equal(getPatrolConfig(guildId).enabled, false);
  assert.equal(getPatrolConfig(guildId).rules.invites, true);

  startWizardDraft(guildId, 'admin', { rules: { bannedTerms: true, invites: false, spam: false }, bannedTerms: ['x'] });
  const cancel = fakeComponent(guild, 'admin', 'patrol-wizard:cancel');
  await wizardPump.execute(cancel);
  assert.equal(getWizardDraft(guildId, 'admin'), null);
  assert.equal(getPatrolConfig(guildId).rules.invites, true, 'cancel changed nothing');
  assert.match(embedText(cancel.state.updates[0]), /Nothing was saved/);
});

test('a press on an expired wizard says so instead of erroring', async () => {
  const guildId = freshGuildId();
  const press = fakeComponent({ id: guildId }, 'admin', 'patrol-wizard:next');
  await wizardPump.execute(press);
  assert.match(embedText(press.state.updates[0]), /expired/i);
});

test('the pump ignores foreign customIds and the text path points at slash', async () => {
  const foreign = fakeComponent({ id: freshGuildId() }, 'admin', 'trivia:answer:1');
  await wizardPump.execute(foreign);
  assert.equal(foreign.state.updates.length, 0, 'not ours — untouched');

  const text = {
    guild: { id: freshGuildId() },
    user: { id: 'admin' },
    memberPermissions: { has: () => true },
    isTextCommand: true,
    replies: [],
    reply: async (p) => text.replies.push(p),
  };
  await patrolWizard.execute(text);
  assert.match(text.replies[0].content, /\/patrol-wizard/);
});

test('cleanup helper', () => {
  clearWizardDraft('nonexistent', 'nobody'); // must never throw
});
