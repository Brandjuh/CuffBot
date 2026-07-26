// S127: the self-updater the bot runs itself.
//
// This chain has been "fixed" four times (S7, S76, S78, S120) and broken again
// every time. The tests below are aimed at the two things that actually decide
// whether a Pi ends up stuck: **can the bot tell what systemd will do when it
// exits**, and **does it ever exit when that would leave it down**.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_CHECK_MS,
  RESULTS,
  applyRestart,
  describeState,
  parseUpdateResult,
  restartPlan,
  restartPolicy,
  runUpdateScript,
} from '../src/modules/core/updater.js';

const ok = (stdout) => () => ({ status: 0, stdout });
const fails = () => () => ({ status: 1, stdout: '' });

// ── reading the script's verdict ─────────────────────────────────────────────

test('every result the script can emit has a meaning', () => {
  // A result the bot cannot name becomes "something happened, unclear what",
  // which is the class of message this whole rebuild exists to delete.
  for (const name of ['up-to-date', 'updated', 'fetch-failed', 'merge-failed', 'install-failed', 'tests-failed']) {
    assert.ok(RESULTS[name], `no meaning for '${name}'`);
    assert.equal(typeof RESULTS[name].text, 'string');
  }
});

test('only `updated` counts as a change, and only it and up-to-date are ok', () => {
  assert.equal(RESULTS.updated.changed, true);
  assert.equal(RESULTS['up-to-date'].changed, false);
  for (const name of ['fetch-failed', 'merge-failed', 'install-failed', 'tests-failed', 'unknown']) {
    assert.equal(RESULTS[name].ok, false, name);
    assert.equal(RESULTS[name].changed, false, `${name} must never trigger a restart`);
  }
});

test('the result line is read out of noisy output', () => {
  const output = [
    'cuffbot-update: updating abc -> def',
    'npm warn deprecated something',
    'CUFFBOT_RESULT=updated abc1234 def5678',
  ].join('\n');
  assert.deepEqual(parseUpdateResult(output), { result: 'updated', from: 'abc1234', to: 'def5678' });
});

test('the LAST result line wins', () => {
  // git and npm share the stream; a stale marker earlier in the log must not
  // outvote the real verdict.
  const output = 'CUFFBOT_RESULT=up-to-date a a\nCUFFBOT_RESULT=tests-failed a b\n';
  assert.equal(parseUpdateResult(output).result, 'tests-failed');
});

test('no result line at all is "unknown", never a silent success', () => {
  assert.deepEqual(parseUpdateResult('some output but no verdict'), { result: 'unknown', from: null, to: null });
  assert.deepEqual(parseUpdateResult(''), { result: 'unknown', from: null, to: null });
  assert.deepEqual(parseUpdateResult(undefined), { result: 'unknown', from: null, to: null });
});

test('an unrecognised result name degrades to unknown rather than being trusted', () => {
  assert.equal(parseUpdateResult('CUFFBOT_RESULT=whatever a b').result, 'unknown');
});

test('"unknown" placeholders in the commit fields become null', () => {
  assert.deepEqual(parseUpdateResult('CUFFBOT_RESULT=fetch-failed unknown unknown'), {
    result: 'fetch-failed',
    from: null,
    to: null,
  });
});

// ── the safety decision ──────────────────────────────────────────────────────

test('systemd is ASKED what it will do, not assumed', () => {
  assert.equal(restartPolicy(ok('always\n')), 'always');
  assert.equal(restartPolicy(ok('on-failure\n')), 'on-failure');
  assert.equal(restartPolicy(fails()), null, 'no systemd is not the same as "always"');
  assert.equal(restartPolicy(ok('  \n')), null, 'an empty answer is no answer');
});

test('the bot exits ONLY when systemd is configured to bring it back', () => {
  // This is the load-bearing assertion of the whole design. Exiting under
  // anything but `always` would take the bot down until a human noticed —
  // strictly worse than not updating.
  assert.equal(restartPlan('always').action, 'exit');
  for (const policy of ['on-failure', 'no', 'on-abort', 'on-success', 'unexpected-value']) {
    assert.notEqual(restartPlan(policy).action, 'exit', `Restart=${policy} must not exit`);
  }
  assert.notEqual(restartPlan(null).action, 'exit', 'no systemd must not exit');
});

test('the fallbacks are the right ones for each situation', () => {
  assert.equal(restartPlan('on-failure').action, 'sudo', 'systemd exists, so ask it');
  assert.equal(restartPlan(null).action, 'manual', 'no systemd to ask');
  for (const policy of ['always', 'on-failure', null]) {
    assert.ok(restartPlan(policy).why.length > 0, 'every plan explains itself');
  }
});

test('applyRestart exits on the exit plan, and does not call sudo', () => {
  let exited = false;
  let sudoCalls = 0;
  const done = applyRestart(restartPlan('always'), {
    exitFn: () => {
      exited = true;
    },
    runner: () => {
      sudoCalls += 1;
      return { status: 0 };
    },
  });
  assert.equal(done, true);
  assert.equal(sudoCalls, 0, 'the whole point is that this path never touches sudo');
  // The exit is deferred by a timer so the reply flushes first.
  assert.equal(exited, false, 'not synchronously');
});

test('applyRestart falls back to sudo, and reports honestly when sudo refuses', () => {
  const calls = [];
  const record = (status) => (cmd, args) => {
    calls.push([cmd, ...args].join(' '));
    return { status };
  };
  assert.equal(applyRestart(restartPlan('on-failure'), { runner: record(0) }), true);
  assert.match(calls[0], /^sudo -n systemctl restart cuffbot$/);
  assert.equal(applyRestart(restartPlan('on-failure'), { runner: record(1) }), false, 'a refusal is reported, not swallowed');
});

test('the manual plan never claims to have restarted anything', () => {
  let exited = false;
  const done = applyRestart(restartPlan(null), { exitFn: () => { exited = true; }, runner: () => ({ status: 0 }) });
  assert.equal(done, false);
  assert.equal(exited, false);
});

// ── running the script ───────────────────────────────────────────────────────

/** A fake child process, enough for the runner's contract. */
function fakeChild() {
  const handlers = {};
  const stream = () => ({ on: (event, fn) => { handlers[`out:${event}`] = fn; } });
  return {
    stdout: stream(),
    stderr: { on: () => {} },
    on: (event, fn) => { handlers[event] = fn; },
    kill: () => { handlers.killed = true; },
    emitData: (text) => handlers['out:data']?.(text),
    close: (code) => handlers.close?.(code),
    fail: (error) => handlers.error?.(error),
    handlers,
  };
}

test('the script is told not to restart — that decision belongs to the bot', async () => {
  let seenEnv = null;
  const child = fakeChild();
  const promise = runUpdateScript({
    spawnFn: (_cmd, _args, opts) => {
      seenEnv = opts.env;
      return child;
    },
  });
  child.emitData('CUFFBOT_RESULT=up-to-date a a\n');
  child.close(0);
  await promise;
  assert.equal(seenEnv.CUFFBOT_NO_RESTART, '1');
});

test('progress lines reach the caller as they arrive', async () => {
  const lines = [];
  const child = fakeChild();
  const promise = runUpdateScript({ onLine: (l) => lines.push(l), spawnFn: () => child });
  child.emitData('cuffbot-update: updating abc -> def\nnpm noise\n');
  child.emitData('CUFFBOT_RESULT=updated abc def\n');
  child.close(0);
  const run = await promise;
  assert.ok(lines.includes('cuffbot-update: updating abc -> def'));
  assert.equal(run.result, 'updated');
});

test('a spawn failure resolves as unknown instead of hanging or throwing', async () => {
  const child = fakeChild();
  const promise = runUpdateScript({ spawnFn: () => child });
  child.fail(new Error('bash missing'));
  const run = await promise;
  assert.equal(run.result, 'unknown');
  assert.match(run.output, /bash missing/);
});

test('a hung update is killed and reported, not left holding the lock', async () => {
  const child = fakeChild();
  const promise = runUpdateScript({ spawnFn: () => child, timeoutMs: 1 });
  const run = await promise;
  assert.equal(run.result, 'unknown');
  assert.equal(child.handlers.killed, true, 'the child is actually killed');
});

test('a late close after the timeout cannot resolve twice', async () => {
  const child = fakeChild();
  const run = await runUpdateScript({ spawnFn: () => child, timeoutMs: 1 });
  assert.equal(run.result, 'unknown');
  child.emitData('CUFFBOT_RESULT=updated a b\n');
  child.close(0); // must not throw — the promise is already settled
});

// ── what the owner reads ─────────────────────────────────────────────────────

const state = (over = {}) => ({
  branch: 'main',
  head: 'abc1234',
  subject: 'Some commit',
  remoteHead: 'def5678',
  fetchOk: true,
  behind: 0,
  policy: 'always',
  plan: restartPlan('always'),
  ...over,
});

test('status says up to date only when it has actually checked', () => {
  assert.match(describeState(state()).join('\n'), /Up to date/);
  // A failed fetch must never read as "up to date" — that is the exact lie
  // that hid the broken updater for five sessions.
  const blind = describeState(state({ fetchOk: false, behind: null })).join('\n');
  assert.doesNotMatch(blind, /Up to date/);
  assert.match(blind, /Cannot reach GitHub/);
});

test('being behind says how far, and how to fix it', () => {
  const body = describeState(state({ behind: 16 }), { prefix: '!' }).join('\n');
  assert.match(body, /16 commits behind/);
  assert.match(body, /abc1234.*def5678/);
  assert.match(body, /`!update` installs it now/);
});

test('one commit behind is singular', () => {
  assert.match(describeState(state({ behind: 1 })).join('\n'), /1 commit behind/);
});

test('status reports the restart route, because it is the thing that breaks', () => {
  assert.match(describeState(state()).join('\n'), /No sudo involved/);

  const wrong = describeState(state({ policy: 'on-failure', plan: restartPlan('on-failure') })).join('\n');
  assert.match(wrong, /Restart=on-failure/);
  assert.match(wrong, /setup-pi\.sh/, 'and names the command that fixes it');

  const none = describeState(state({ policy: null, plan: restartPlan(null) })).join('\n');
  assert.match(none, /no systemd/i);
});

test('status names the automatic interval the owner asked for', () => {
  assert.equal(AUTO_CHECK_MS, 15 * 60_000);
  assert.match(describeState(state(), { autoOn: true }).join('\n'), /every 15 minutes/);
  assert.match(describeState(state(), { autoOn: false }).join('\n'), /Automatic checks:\*\* off/);
});

test('a broken checkout is said plainly rather than guessed around', () => {
  const body = describeState(state({ head: null })).join('\n');
  assert.match(body, /Cannot read the checkout/);
  assert.doesNotMatch(body, /Up to date/);
});

test('no status line ever claims a cause it has not checked', () => {
  // S120's lesson, as a guard: the old message asserted "the updater never
  // ran" from nothing but an unchanged HEAD.
  for (const over of [{}, { behind: 5 }, { fetchOk: false, behind: null }, { policy: 'on-failure', plan: restartPlan('on-failure') }]) {
    const body = describeState(state(over)).join('\n');
    assert.doesNotMatch(body, /never ran/i, JSON.stringify(over));
    assert.doesNotMatch(body, /probably missing/i, JSON.stringify(over));
  }
});
