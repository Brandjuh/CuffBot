import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { getGuildData, readGuildData, setGuildData, updateGuildData } from '../src/core/store.js';

function scratch() {
  const dir = mkdtempSync(path.join(tmpdir(), 'cuffbot-store-'));
  return { dir, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test('missing file yields the fallback', () => {
  const { dir, done } = scratch();
  try {
    assert.deepEqual(readGuildData('g1', { dir }), {});
    assert.equal(getGuildData('g1', 'answer', 42, { dir }), 42);
  } finally {
    done();
  }
});

test('set + get roundtrip persists across reads', () => {
  const { dir, done } = scratch();
  try {
    setGuildData('g1', 'config', { channel: 'evidence-locker' }, { dir });
    assert.deepEqual(getGuildData('g1', 'config', null, { dir }), { channel: 'evidence-locker' });
    setGuildData('g1', 'other', 1, { dir });
    // first key untouched by writes to a second key
    assert.deepEqual(getGuildData('g1', 'config', null, { dir }), { channel: 'evidence-locker' });
  } finally {
    done();
  }
});

test('corrupt file is moved aside and store starts fresh', () => {
  const { dir, done } = scratch();
  try {
    writeFileSync(path.join(dir, 'g1.json'), '{ this is not json');
    assert.deepEqual(readGuildData('g1', { dir }), {});
    const backups = readdirSync(dir).filter((f) => f.includes('corrupt'));
    assert.equal(backups.length, 1, 'corrupt file preserved as backup');
    // and writing works again afterwards
    setGuildData('g1', 'k', 'v', { dir });
    assert.equal(getGuildData('g1', 'k', null, { dir }), 'v');
  } finally {
    done();
  }
});

test('updateGuildData applies the updater to current-or-fallback', () => {
  const { dir, done } = scratch();
  try {
    const first = updateGuildData('g1', 'counter', (n) => n + 1, 0, { dir });
    const second = updateGuildData('g1', 'counter', (n) => n + 1, 0, { dir });
    assert.equal(first, 1);
    assert.equal(second, 2);
  } finally {
    done();
  }
});

test('writes are atomic: no temp files left behind', () => {
  const { dir, done } = scratch();
  try {
    for (let i = 0; i < 20; i += 1) setGuildData('g1', `k${i}`, i, { dir });
    const leftovers = readdirSync(dir).filter((f) => f.includes('.tmp-'));
    assert.deepEqual(leftovers, []);
  } finally {
    done();
  }
});
