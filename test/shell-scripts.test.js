// The install and update scripts, checked the only ways a JS test can check
// bash: syntax, and the traps that have actually bitten.
//
// ⚠️ This file exists because S127 shipped a real one. Comments explaining the
// new `Restart=always` were written with markdown backticks and placed INSIDE
// the unit-file heredoc — which is unquoted, because it has to expand `$USER`
// and `$(command -v node)`. Bash therefore ran the backticked words as
// commands, and the owner's install printed:
//
//     scripts/setup-pi.sh: line 121: always: command not found
//     scripts/setup-pi.sh: line 121: on-failure: command not found
//     scripts/setup-pi.sh: line 121: !update: command not found
//
// The unit still came out right (the substitutions produced empty strings), so
// nothing broke — but a script that prints four errors during a fix for a
// four-times-broken subsystem is not something to leave to the next reader.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const SCRIPTS = ['scripts/setup-pi.sh', 'scripts/update.sh'];
const read = (rel) => readFileSync(path.join(REPO, rel), 'utf8');

/**
 * Walk a shell script's heredocs.
 *
 * @returns {Array<{delimiter:string, quoted:boolean, startLine:number, lines:Array<{n:number, text:string}>}>}
 */
function heredocs(source) {
  const found = [];
  let open = null;
  source.split('\n').forEach((text, index) => {
    const n = index + 1;
    if (open) {
      if (text.trim() === open.delimiter) {
        found.push(open);
        open = null;
      } else {
        open.lines.push({ n, text });
      }
      return;
    }
    const match = /<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/.exec(text);
    if (match) open = { delimiter: match[2], quoted: match[1] !== '', startLine: n, lines: [] };
  });
  return found;
}

test('both scripts parse', () => {
  for (const script of SCRIPTS) {
    execFileSync('bash', ['-n', path.join(REPO, script)], { stdio: 'pipe' });
  }
});

test('no UNQUOTED heredoc contains a backtick — bash would run it', () => {
  // The exact bug S127 shipped. An unquoted heredoc is chosen deliberately
  // (it must expand $USER and $(command -v node)), which makes every backtick
  // in it a command substitution, including ones inside `#` comments.
  for (const script of SCRIPTS) {
    for (const doc of heredocs(read(script))) {
      if (doc.quoted) continue;
      for (const { n, text } of doc.lines) {
        assert.ok(
          !text.includes('`'),
          `${script}:${n} has a backtick inside unquoted heredoc <<${doc.delimiter} — bash will execute it:\n    ${text}`,
        );
      }
    }
  }
});

test('the parser actually sees the heredocs it is meant to guard', () => {
  // Without this the test above passes trivially if the regex ever stops
  // matching — the guard would be checking an empty list forever.
  const docs = heredocs(read('scripts/setup-pi.sh'));
  assert.ok(docs.length >= 1, 'setup-pi.sh writes at least one unit file');
  assert.ok(
    docs.some((doc) => doc.lines.some((line) => line.text.startsWith('Restart='))),
    'the service unit heredoc must be among them',
  );
});

test('the service unit sets Restart=always — the whole update design rests on it', () => {
  // S127: the bot installs an update and then EXITS, expecting systemd to
  // bring it back. Under any other policy it would stay down.
  const source = read('scripts/setup-pi.sh');
  assert.match(source, /^Restart=always$/m);
  assert.doesNotMatch(source, /^Restart=on-failure$/m, 'the old policy would strand the bot after a self-update');
});

test('setup-pi.sh removes the pre-S127 update machinery rather than installing it', () => {
  const source = read('scripts/setup-pi.sh');
  // Two updaters racing is worse than one, and the old one uses the sudo path
  // that broke four times.
  assert.match(source, /rm -f "\/etc\/systemd\/system\/\$unit"/);
  assert.match(source, /rm -f \/etc\/sudoers\.d\/cuffbot/);
  assert.doesNotMatch(source, /tee \/etc\/systemd\/system\/cuffbot-update\.(service|timer)/, 'must not re-install them');
  assert.doesNotMatch(source, /tee "?\$SUDOERS"?/, 'must not re-install the sudoers drop-in');
});

test('update.sh reports a machine-readable result on every exit path', () => {
  // The bot classifies runs off this line. A path that can exit without one
  // is a path the bot has to guess about, and guessing is what produced "the
  // updater never ran".
  const source = read('scripts/update.sh');
  const results = [...source.matchAll(/^\s*result (\S+)/gm)].map((m) => m[1]);
  for (const expected of ['up-to-date', 'updated', 'fetch-failed', 'merge-failed', 'install-failed', 'tests-failed']) {
    assert.ok(results.includes(expected), `no 'result ${expected}' in update.sh`);
  }
  // Every `exit` must be preceded by a result. Counting is enough: the script
  // is small, and a bare exit would show up as more exits than results.
  const exits = [...source.matchAll(/^\s*exit \d/gm)].length;
  assert.ok(results.length >= exits, `${exits} exits but only ${results.length} result lines`);
});

test('update.sh honours CUFFBOT_NO_RESTART, and skips the only sudo it has', () => {
  // ⚠️ The first version searched for the bare string `CUFFBOT_NO_RESTART`,
  // which appears in the file's HEADER COMMENT — so it measured the comment's
  // position, not the guard's, and passed against a build with the guard
  // moved after the sudo block. Match the actual `if`, not a word that also
  // occurs in prose.
  const source = read('scripts/update.sh');
  const guard = source.search(/^if \[ "\$\{CUFFBOT_NO_RESTART:-\}" = "1" \]; then$/m);
  const sudo = source.indexOf('sudo -n systemctl restart cuffbot');
  assert.ok(guard > 0, 'the guard itself must exist, not just a mention of the flag');
  assert.ok(sudo > 0, 'and the sudo block it is meant to skip');
  assert.ok(sudo > guard, 'the early return must come BEFORE the sudo block, or the flag does nothing');
});
