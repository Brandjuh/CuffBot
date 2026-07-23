import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectBannedTerms,
  detectInvites,
  detectSpam,
  normalizeForMatch,
  screenMessage,
  summarizeViolations,
} from '../src/modules/patrol/lib/screen.js';

test('normalizeForMatch collapses evasion tricks', () => {
  assert.equal(normalizeForMatch('B a d W o r d'), 'badword');
  assert.equal(normalizeForMatch('b@dw0rd'), 'badword');
  assert.equal(normalizeForMatch('B.A.D-W.O.R.D'), 'badword');
});

test('detectBannedTerms matches through spacing and leetspeak', () => {
  assert.deepEqual(detectBannedTerms('you are a b@d w0rd', ['badword']), ['badword']);
  assert.deepEqual(detectBannedTerms('totally clean', ['badword']), []);
  assert.deepEqual(detectBannedTerms('hello', []), []);
});

test('detectInvites catches the common invite forms, spacing-tolerant', () => {
  assert.equal(detectInvites('join discord.gg/abc123'), true);
  assert.equal(detectInvites('https://discord.com/invite/xyz'), true);
  assert.equal(detectInvites('discord . gg / sneaky'), true);
  assert.equal(detectInvites('check out my server later'), false);
});

test('detectSpam flags mention floods and character runs', () => {
  assert.match(detectSpam('<@1> <@2> <@3> <@4> <@5> <@6>'), /mention flood/);
  assert.match(detectSpam('aaaaaaaaaaaa'), /repeated characters/);
  assert.equal(detectSpam('a normal sentence'), null);
});

test('screenMessage respects rule toggles and the banned list', () => {
  const config = { enabled: true, rules: { bannedTerms: true, invites: true, spam: true }, bannedTerms: ['badword'] };
  assert.deepEqual(screenMessage('nothing wrong here', config), []);

  const v = screenMessage('badword and discord.gg/x', config);
  assert.deepEqual(v.map((x) => x.type).sort(), ['banned-term', 'invite-link']);

  const noInvites = screenMessage('discord.gg/x', { ...config, rules: { ...config.rules, invites: false } });
  assert.deepEqual(noInvites, []);
});

test('screenMessage does nothing when the banned list is empty', () => {
  const config = { enabled: true, rules: { bannedTerms: true, invites: false, spam: false }, bannedTerms: [] };
  assert.deepEqual(screenMessage('anything at all', config), []);
});

test('summarizeViolations reads clearly', () => {
  const summary = summarizeViolations([
    { type: 'banned-term', detail: ['badword'] },
    { type: 'invite-link' },
    { type: 'spam', detail: 'mention flood (6)' },
  ]);
  assert.match(summary, /banned term \(badword\)/);
  assert.match(summary, /invite link/);
  assert.match(summary, /spam: mention flood/);
});
