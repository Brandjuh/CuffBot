import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { addRecord, expungeRecords, recordsFor } from '../src/modules/records/lib/api.js';
import { formatRapSheet } from '../src/modules/records/lib/format.js';

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'cuffbot-records-'));
  return { options: { dir }, done: () => rmSync(dir, { recursive: true, force: true }) };
}

const G = '411157175948541954';

test('case numbers increment and entries accumulate', () => {
  const { options, done } = scratch();
  try {
    const a = addRecord(G, { type: 'citation', userId: 'u1', officerId: 'o1', reason: 'spam' }, options);
    const b = addRecord(G, { type: 'arrest', userId: 'u1', officerId: 'o1' }, options);
    const c = addRecord(G, { type: 'citation', userId: 'u2', officerId: 'o1' }, options);
    assert.deepEqual([a.caseNumber, b.caseNumber, c.caseNumber], [1, 2, 3]);
    assert.equal(recordsFor(G, 'u1', options).length, 2);
    assert.equal(recordsFor(G, 'u2', options).length, 1);
    assert.match(a.at, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    done();
  }
});

test('unknown record types are rejected', () => {
  const { options, done } = scratch();
  try {
    assert.throws(
      () => addRecord(G, { type: 'compliment', userId: 'u', officerId: 'o' }, options),
      /Unknown record type/,
    );
  } finally {
    done();
  }
});

test('expunge one case vs the whole sheet', () => {
  const { options, done } = scratch();
  try {
    addRecord(G, { type: 'citation', userId: 'u1', officerId: 'o' }, options);
    addRecord(G, { type: 'citation', userId: 'u1', officerId: 'o' }, options);
    addRecord(G, { type: 'citation', userId: 'u2', officerId: 'o' }, options);

    assert.deepEqual(expungeRecords(G, 'u1', 2, options), { removed: 1 });
    assert.equal(recordsFor(G, 'u1', options).length, 1);

    assert.deepEqual(expungeRecords(G, 'u1', null, options), { removed: 1 });
    assert.equal(recordsFor(G, 'u1', options).length, 0);
    // other member untouched; numbering continues (case numbers are never reused)
    assert.equal(recordsFor(G, 'u2', options).length, 1);
    const d = addRecord(G, { type: 'release', userId: 'u2', officerId: 'o' }, options);
    assert.equal(d.caseNumber, 4);
  } finally {
    done();
  }
});

test('formatRapSheet: clean sheet, counts, and truncation', () => {
  assert.match(formatRapSheet('Angel', []), /Clean sheet/);

  const entries = [
    { caseNumber: 1, type: 'citation', userId: 'u', officerId: 'o1', reason: 'spam', at: '2026-07-23T10:00:00Z' },
    { caseNumber: 2, type: 'detainment', userId: 'u', officerId: 'o1', reason: null, at: '2026-07-23T11:00:00Z' },
    { caseNumber: 3, type: 'citation', userId: 'u', officerId: 'o2', reason: 'more spam', at: '2026-07-23T12:00:00Z' },
  ];
  const sheet = formatRapSheet('Perp', entries);
  assert.match(sheet, /RAP SHEET — PERP/);
  assert.match(sheet, /2 citations/);
  assert.match(sheet, /1 detainment/);
  assert.match(sheet, /#0003/); // newest shown
  assert.match(sheet, /officer <@o2>/);

  const many = Array.from({ length: 25 }, (_, i) => ({
    caseNumber: i + 1,
    type: 'citation',
    userId: 'u',
    officerId: 'o',
    reason: `offense number ${i + 1}`,
    at: '2026-07-23T10:00:00Z',
  }));
  const long = formatRapSheet('Repeat Offender', many);
  assert.match(long, /and 15 older record\(s\)/);
  assert.ok(long.length <= 1990);
});
