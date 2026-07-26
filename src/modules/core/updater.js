// The self-updater the bot RUNS ITSELF (S127).
//
// ⚠️ Read this before changing anything here. The update chain has been fixed
// four times — S7, S76, S78, S120 — and broke again every time, always in the
// same place: a systemd unit or a sudo rule. The owner's fifth report was
// *"los dit nu voor eens en altijd op"*, and the reason it kept coming back is
// architectural, not a bug list:
//
//   * the bot asked `sudo` to start a SECOND systemd service, so the path
//     depended on a sudoers line matching a command line exactly (S120: it had
//     not matched since S7);
//   * a systemd TIMER did the unattended runs, so the bot could not see, fix
//     or report on them;
//   * and the fix for a broken updater always shipped in commits the broken
//     updater could not fetch. That is a deadlock, not a bug — which is why
//     the Pi sat 16 commits behind printing a diagnosis written before S120.
//
// **So the updater no longer needs any of it.** The bot runs the script as an
// ordinary child process and then **exits**; systemd's `Restart=always` brings
// it back on the new code. No sudo, no second unit, no timer, nothing that can
// be missing. The only thing that must be true on the Pi is `Restart=always`,
// and `restartPlan` below CHECKS it rather than assuming — because assuming is
// how the last four attempts failed.
import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../../core/logger.js';

const REPO_DIR = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

/** The owner's interval, unattended. */
export const AUTO_CHECK_MS = 15 * 60_000;
/** A Pi runs `npm install` plus the whole suite; give it room. */
export const UPDATE_TIMEOUT_MS = 25 * 60_000;

/** Every outcome `scripts/update.sh` can report, and what it means to a human. */
export const RESULTS = {
  'up-to-date': { ok: true, changed: false, text: 'Already on the latest version.' },
  updated: { ok: true, changed: true, text: 'Updated and tested green.' },
  'fetch-failed': {
    ok: false,
    changed: false,
    text: 'Could not reach GitHub — network, or the stored git credentials expired.',
  },
  'merge-failed': {
    ok: false,
    changed: false,
    text: 'Fast-forward refused — there are local edits in the checkout on the Pi.',
  },
  'install-failed': { ok: false, changed: false, text: '`npm install` failed; rolled back.' },
  'tests-failed': {
    ok: false,
    changed: false,
    text: 'The new version FAILED its tests and was rolled back. The old one is still running.',
  },
  unknown: { ok: false, changed: false, text: 'The update script ended without saying what happened.' },
};

/**
 * Read the script's machine-readable last line.
 *
 * Pure, and deliberately tolerant: it scans for the marker anywhere in the
 * output rather than requiring the final line, because npm and git write to
 * the same stream and their ordering is not ours to control.
 *
 * @returns {{result: string, from: string|null, to: string|null}}
 */
export function parseUpdateResult(output) {
  const matches = [...String(output ?? '').matchAll(/^CUFFBOT_RESULT=(\S+)\s+(\S+)\s+(\S+)\s*$/gm)];
  const last = matches.at(-1);
  if (!last) return { result: 'unknown', from: null, to: null };
  const [, result, from, to] = last;
  return {
    result: result in RESULTS ? result : 'unknown',
    from: from === 'unknown' ? null : from,
    to: to === 'unknown' ? null : to,
  };
}

/**
 * What systemd will do when this process exits — asked, never assumed.
 *
 * @returns {'always'|'on-failure'|'no'|string|null} null when systemd cannot be queried
 */
export function restartPolicy(runner = spawnSync, unit = 'cuffbot') {
  const res = runner('systemctl', ['show', unit, '-p', 'Restart', '--value'], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  if (res.status !== 0 || typeof res.stdout !== 'string') return null;
  const value = res.stdout.trim();
  return value.length > 0 ? value : null;
}

/**
 * How to get the new code running, given what systemd is configured to do.
 *
 * Pure, and the whole safety argument lives here: **exiting is only safe when
 * systemd will restart us.** Exiting under `Restart=on-failure` would take the
 * bot down until somebody noticed, which is worse than not updating at all.
 *
 * @returns {{action:'exit'|'sudo'|'manual', why:string}}
 */
export function restartPlan(policy) {
  if (policy === 'always') return { action: 'exit', why: 'systemd restarts me on a clean exit' };
  if (policy === null) {
    // No systemd at all (a dev box, a container). Exiting would just stop.
    return { action: 'manual', why: 'systemd is not available here' };
  }
  return { action: 'sudo', why: `Restart=${policy} — a clean exit would leave me down, so I ask systemd instead` };
}

/**
 * Run the updater. Awaited, in-process, no detachment: the bot stays
 * responsive because this is a child process, and nothing can kill it
 * half-way because nothing restarts anything until it has returned.
 *
 * @param {(line: string) => void} [onLine] progress, for a live status message
 * @returns {Promise<{result:string, from:string|null, to:string|null, code:number|null, output:string}>}
 */
export function runUpdateScript({ onLine = () => {}, timeoutMs = UPDATE_TIMEOUT_MS, spawnFn = spawn } = {}) {
  return new Promise((resolve) => {
    let output = '';
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ...parseUpdateResult(output), code, output });
    };

    const child = spawnFn('bash', [path.join(REPO_DIR, 'scripts', 'update.sh')], {
      cwd: REPO_DIR,
      // The script skips its own restart section; the bot owns that decision.
      env: { ...process.env, CUFFBOT_NO_RESTART: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const collect = (chunk) => {
      const text = String(chunk);
      output += text;
      for (const line of text.split('\n')) if (line.trim()) onLine(line.trim());
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.on('error', (error) => {
      output += `\nspawn failed: ${error.message}`;
      finish(null);
    });
    child.on('close', finish);

    // Deliberately NOT unref'd. Every other timer in the repo is, because they
    // are pollers that must not hold the process open — this one must be able
    // to fire even if it is the only thing left on the loop, or a hung update
    // would hold the lock forever with nothing to break it. It is cleared the
    // moment the run settles, so it cannot outlive the update either way.
    const timer = setTimeout(() => {
      // Killing the script is safe: it is idempotent, and a half-finished run
      // rolls itself back on the next one because the merge is redone first.
      child.kill('SIGTERM');
      output += '\nCUFFBOT_RESULT=unknown unknown unknown';
      finish(null);
    }, timeoutMs);
  });
}

/** Carry out a restart plan. Returns false only when the caller must be told. */
export function applyRestart(plan, { exitFn = () => process.exit(0), runner = spawnSync } = {}) {
  if (plan.action === 'exit') {
    logger.info('Update: new code on disk — exiting so systemd restarts me into it.');
    // A tick of grace so the reply is actually flushed to Discord first.
    setTimeout(exitFn, 1_500).unref?.();
    return true;
  }
  if (plan.action === 'sudo') {
    const res = runner('sudo', ['-n', 'systemctl', 'restart', 'cuffbot'], { timeout: 15_000 });
    if (res.status === 0) return true;
    logger.warn('Update: sudo restart refused; the operator must restart by hand.');
    return false;
  }
  return false;
}

/**
 * The full state `!update status` reports — every fact it can actually check,
 * and no cause it has not.
 *
 * @returns {Promise<object>}
 */
export async function updateState({ runner = spawnSync } = {}) {
  const git = (args) => {
    const res = runner('git', args, { cwd: REPO_DIR, encoding: 'utf8', timeout: 20_000 });
    return res.status === 0 ? String(res.stdout).trim() : null;
  };

  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = git(['rev-parse', '--short', 'HEAD']);
  const subject = git(['log', '-1', '--format=%s']);
  const fetched = branch ? runner('git', ['fetch', '--quiet', 'origin', branch], { cwd: REPO_DIR, timeout: 30_000 }) : null;
  const fetchOk = fetched?.status === 0;
  const behindRaw = fetchOk && branch ? git(['rev-list', '--count', `HEAD..origin/${branch}`]) : null;
  const remoteHead = fetchOk && branch ? git(['rev-parse', '--short', `origin/${branch}`]) : null;

  const policy = restartPolicy(runner);
  return {
    branch,
    head,
    subject,
    remoteHead,
    fetchOk,
    behind: behindRaw === null ? null : Number(behindRaw),
    policy,
    plan: restartPlan(policy),
  };
}

/**
 * The status text — every line a fact, and the one thing that could still be
 * wrong named with the exact command that fixes it.
 */
export function describeState(state, { autoOn = true, lastRun = null, prefix = '!' } = {}) {
  const lines = [];

  if (!state.head) {
    return ['🚫 **Cannot read the checkout** — git is unavailable where I am running. Nothing about versions can be trusted until that is fixed.'];
  }

  if (!state.fetchOk) {
    lines.push('🚨 **Cannot reach GitHub.** Network, or the stored git credentials expired.');
    lines.push(`-# On the Pi: \`cd ~/CuffBot && git fetch origin\` — if it asks for a password, the credential store is gone and \`bash scripts/setup-pi.sh\` restores it.`);
  } else if (state.behind === 0) {
    lines.push(`✅ **Up to date** — \`${state.head}\` is the latest on \`${state.branch}\`.`);
  } else {
    lines.push(`⬇️ **${state.behind} commit${state.behind === 1 ? '' : 's'} behind** — \`${state.head}\` → \`${state.remoteHead}\`.`);
    lines.push(`-# \`${prefix}update\` installs it now.`);
  }

  if (state.subject) lines.push(`-# Running: *${state.subject}*`);

  lines.push('');
  lines.push(`**Automatic checks:** ${autoOn ? `on, every ${AUTO_CHECK_MS / 60_000} minutes` : 'off'}`);
  if (lastRun) lines.push(`-# Last check: <t:${Math.floor(lastRun.at / 1000)}:R> — ${RESULTS[lastRun.result]?.text ?? lastRun.result}`);

  // The one precondition of the whole design, checked rather than assumed.
  if (state.plan.action === 'exit') {
    lines.push('**Restart route:** clean exit → systemd restarts me. No sudo involved. ✅');
  } else if (state.plan.action === 'sudo') {
    lines.push(
      `⚠️ **Restart route:** \`Restart=${state.policy}\`, so I cannot restart by exiting and have to ask sudo — the exact thing that has broken four times.`,
    );
    lines.push('-# Fix it permanently on the Pi: `bash scripts/setup-pi.sh` (it now writes `Restart=always`).');
  } else {
    lines.push('⚠️ **Restart route:** no systemd here, so I can install an update but not load it. A human must restart me.');
  }

  return lines;
}
