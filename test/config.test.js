import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../src/core/config.js';

const CFG_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-config-'));
after(() => rmSync(CFG_DIR, { recursive: true, force: true }));
let cfgCounter = 0;
function settingsFile(obj) {
  cfgCounter += 1;
  const p = path.join(CFG_DIR, `cfg-${cfgCounter}.json`);
  writeFileSync(p, JSON.stringify(obj));
  return p;
}

test('loadConfig fails fast with a clear message when env vars are missing', () => {
  assert.throws(
    () => loadConfig({ env: {} }),
    /Missing required environment variables: DISCORD_TOKEN, CLIENT_ID/,
  );
});

test('loadConfig names only the vars that are actually missing', () => {
  assert.throws(
    () => loadConfig({ env: { DISCORD_TOKEN: 'x'.repeat(10) } }),
    /Missing required environment variables: CLIENT_ID/,
  );
});

test('loadConfig returns token, clientId, and the home guild from config.json', () => {
  const config = loadConfig({ env: { DISCORD_TOKEN: 'test-token', CLIENT_ID: '123' } });
  assert.equal(config.token, 'test-token');
  assert.equal(config.clientId, '123');
  assert.match(config.homeGuildId, /^\d{17,20}$/);
  assert.equal(config.homeGuildId, '411157175948541954');
  assert.equal(config.prefix, '!'); // default prefix from config.json
});

test('loadConfig accepts a valid custom prefix', () => {
  const config = loadConfig({
    env: { DISCORD_TOKEN: 't', CLIENT_ID: 'c' },
    settingsFile: settingsFile({ homeGuildId: '411157175948541954', prefix: '?' }),
  });
  assert.equal(config.prefix, '?');
});

test('loadConfig rejects an invalid prefix (multi-char, whitespace, or "/")', () => {
  const env = { DISCORD_TOKEN: 't', CLIENT_ID: 'c' };
  for (const bad of ['!!', ' ', '/', '']) {
    assert.throws(
      () => loadConfig({ env, settingsFile: settingsFile({ homeGuildId: '411157175948541954', prefix: bad }) }),
      /prefix must be a single character/,
      `expected rejection for prefix ${JSON.stringify(bad)}`,
    );
  }
});

test('loadConfig rejects a settings file without a valid homeGuildId', () => {
  assert.throws(
    () =>
      loadConfig({
        env: { DISCORD_TOKEN: 't', CLIENT_ID: 'c' },
        settingsFile: new URL('./fixtures/bad-config.json', import.meta.url).pathname,
      }),
    /homeGuildId/,
  );
});
