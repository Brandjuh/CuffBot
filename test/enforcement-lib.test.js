import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_TIMEOUT_MS, formatDuration, parseDuration } from '../src/modules/enforcement/lib/duration.js';
import { AUDIT_REASON_LIMIT, DEFAULT_REASON, auditReason } from '../src/modules/enforcement/lib/audit.js';
import { wrapText } from '../src/modules/enforcement/lib/citation-card.js';

test('parseDuration handles the roadmap cases', () => {
  assert.equal(parseDuration('10m'), 10 * 60_000);
  assert.equal(parseDuration('2h'), 2 * 3_600_000);
  assert.equal(parseDuration('7d'), 7 * 86_400_000);
  assert.equal(parseDuration('90s'), 90_000);
});

test('parseDuration handles compounds, case, and whitespace', () => {
  assert.equal(parseDuration('1h30m'), 90 * 60_000);
  assert.equal(parseDuration('1H 30M'), 90 * 60_000);
  assert.equal(parseDuration(' 2d 12h '), 60 * 3_600_000);
});

test('parseDuration rejects what it does not understand', () => {
  for (const bad of ['', 'x', '10', 'm5', '-5m', '1.5h', '10 minutes', null, undefined]) {
    assert.equal(parseDuration(bad), null, `expected null for ${JSON.stringify(bad)}`);
  }
});

test('the 28-day cap is enforced by callers via MAX_TIMEOUT_MS', () => {
  assert.equal(parseDuration('28d'), MAX_TIMEOUT_MS);
  assert.ok(parseDuration('28d1s') > MAX_TIMEOUT_MS);
});

test('formatDuration renders humans-first', () => {
  assert.equal(formatDuration(90 * 60_000), '1 hour 30 minutes');
  assert.equal(formatDuration(28 * 86_400_000), '28 days');
  assert.equal(formatDuration(61_000), '1 minute 1 second');
  assert.equal(formatDuration(0), '0 seconds');
});

test('auditReason embeds the officer and defaults the reason', () => {
  assert.equal(auditReason('spam', 'brand'), 'spam — by brand via CuffBot');
  assert.equal(auditReason(null, 'brand'), `${DEFAULT_REASON} — by brand via CuffBot`);
  assert.equal(auditReason('   ', 'brand'), `${DEFAULT_REASON} — by brand via CuffBot`);
});

test('auditReason never exceeds the Discord limit', () => {
  const long = 'x'.repeat(600);
  const result = auditReason(long, 'officer-with-a-name');
  assert.ok(result.length <= AUDIT_REASON_LIMIT, `length ${result.length}`);
  assert.ok(result.endsWith('— by officer-with-a-name via CuffBot'));
  assert.ok(result.includes('…'));
});

test('wrapText wraps on words, hard-cuts monsters, and caps lines', () => {
  assert.deepEqual(wrapText('one two three', 8, 3), ['one two', 'three']);
  assert.deepEqual(wrapText('abcdefghij', 4, 3), ['abcd', 'efgh', 'ij']);
  const capped = wrapText('word '.repeat(40), 10, 2);
  assert.equal(capped.length, 2);
  assert.ok(capped[1].endsWith('…'));
});
