// Packaging guard. Local tests read files from DISK, but the Pi receives only
// what git TRACKS — so a file that exists here yet is ignored (e.g. by an
// over-broad .gitignore pattern) passes every local test and then fails in
// production. S24 incident: a bare "data/" ignore rule silently kept the
// trivia and chat-starter question banks out of every commit; the Pi's
// update gate caught it. This test makes that class of drift impossible:
// every data file a module has on disk must also be tracked by git.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

function git(...args) {
  return spawnSync('git', args, { cwd: repoRoot, encoding: 'utf8', timeout: 15_000 });
}

const inGitCheckout = git('rev-parse', '--is-inside-work-tree').stdout?.trim() === 'true';

test('every module data file on disk is tracked by git', { skip: !inGitCheckout }, () => {
  const modulesDir = path.join(repoRoot, 'src', 'modules');
  const problems = [];
  for (const moduleName of readdirSync(modulesDir)) {
    const dataDir = path.join(modulesDir, moduleName, 'data');
    if (!existsSync(dataDir)) continue;
    for (const file of readdirSync(dataDir)) {
      const rel = path.join('src', 'modules', moduleName, 'data', file);
      const tracked = git('ls-files', '--error-unmatch', rel);
      if (tracked.status !== 0) {
        const ignored = git('check-ignore', '-v', rel).stdout.trim();
        problems.push(`${rel} is NOT tracked${ignored ? ` (ignored by: ${ignored})` : ''}`);
      }
    }
  }
  assert.deepEqual(
    problems,
    [],
    `These files exist locally but would be missing on any fresh clone:\n${problems.join('\n')}\n` +
      'Fix the .gitignore pattern (anchor it: "/data/") and git add the files.',
  );
});

test('the runtime store directory itself stays ignored', { skip: !inGitCheckout }, () => {
  const check = git('check-ignore', 'data/some-guild.json');
  assert.equal(check.status, 0, 'root data/ must remain gitignored (member data never gets committed)');
});
