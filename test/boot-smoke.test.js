// Boot smoke tests. Unit tests import module code but never execute
// src/index.js or src/deploy-commands.js top-to-bottom — so a defect that only
// bites at process start (bad import, top-level ReferenceError) would pass the
// suite and crash-loop the live bot. These tests actually spawn both entry
// points in an empty working directory (no .env there, credentials stripped)
// and assert they fail FAST with the friendly missing-env message — proving
// the whole import graph evaluates without ever touching the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function bootWithoutCredentials(entry) {
  const cwd = mkdtempSync(path.join(tmpdir(), 'cuffbot-boot-'));
  const env = { ...process.env };
  delete env.DISCORD_TOKEN;
  delete env.CLIENT_ID;
  try {
    return spawnSync(process.execPath, [path.join(repoRoot, entry)], {
      cwd, // no .env here, so credentials stay missing and no login is attempted
      env,
      encoding: 'utf8',
      timeout: 30_000,
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

for (const entry of ['src/index.js', 'src/deploy-commands.js']) {
  test(`${entry} evaluates its import graph and fails fast without credentials`, () => {
    const res = bootWithoutCredentials(entry);
    assert.notEqual(res.status, 0, 'must exit non-zero without credentials');
    const output = `${res.stdout}\n${res.stderr}`;
    assert.match(
      output,
      /Missing required environment variables/,
      `expected the friendly config error, got:\n${output.slice(0, 800)}`,
    );
    assert.doesNotMatch(
      output,
      /SyntaxError|ReferenceError|Cannot find module|ERR_MODULE_NOT_FOUND/,
      `boot-level defect detected:\n${output.slice(0, 800)}`,
    );
  });
}
