import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/core/config.js';

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
