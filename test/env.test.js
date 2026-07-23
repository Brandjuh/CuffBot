import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, rmSync } from 'node:fs';
import { loadEnvFile } from '../src/core/env.js';

const FIXTURE = 'test/fixtures/tmp-env-test.env';

function load(content, env = {}) {
  writeFileSync(FIXTURE, content);
  try {
    const found = loadEnvFile(FIXTURE, env);
    return { found, env };
  } finally {
    rmSync(FIXTURE, { force: true });
  }
}

test('parses plain KEY=VALUE pairs', () => {
  const { env } = load('DISCORD_TOKEN=abc.def.ghi\nCLIENT_ID=123\n');
  assert.equal(env.DISCORD_TOKEN, 'abc.def.ghi');
  assert.equal(env.CLIENT_ID, '123');
});

test('strips surrounding quotes and tolerates CRLF', () => {
  const { env } = load('A="quoted value"\r\nB=\'single\'\r\n');
  assert.equal(env.A, 'quoted value');
  assert.equal(env.B, 'single');
});

test('ignores comments and malformed lines', () => {
  const { env } = load('# comment\nnot a pair\nGOOD=yes\n');
  assert.deepEqual(env, { GOOD: 'yes' });
});

test('does not overwrite variables that already exist', () => {
  const { env } = load('A=file', { A: 'environment' });
  assert.equal(env.A, 'environment');
});

test('missing file returns false and leaves env untouched', () => {
  const env = {};
  assert.equal(loadEnvFile('test/fixtures/does-not-exist.env', env), false);
  assert.deepEqual(env, {});
});
