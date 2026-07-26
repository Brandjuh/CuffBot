// Status plumbing for the manual /update command: knowing which commit is on
// disk, remembering who ordered an update (so the bot can report back after
// the restart kills the process mid-command), and classifying what the
// updater did. Pure logic is injectable/testable; only getHead touches git.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGuildData, setGuildData } from '../../core/store.js';

export const UPDATE_MARKER_KEY = 'updateReport';
export const MARKER_FRESH_MS = 30 * 60_000; // older markers are stale — never report on them

const REPO_DIR = path.resolve(fileURLToPath(new URL('../../../', import.meta.url)));

/** The commit currently on disk: { head, subject } (nulls when git is unavailable). */
export function getHead(runner = spawnSync) {
  const head = runner('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO_DIR, encoding: 'utf8', timeout: 10_000 });
  if (head.status !== 0) return { head: null, subject: null };
  const subject = runner('git', ['log', '-1', '--format=%s'], { cwd: REPO_DIR, encoding: 'utf8', timeout: 10_000 });
  return {
    head: head.stdout.trim(),
    subject: subject.status === 0 ? subject.stdout.trim() : null,
  };
}

/**
 * Remember an ordered update/restart so the post-restart boot can report back.
 * `kind` distinguishes the report: 'update' (default) compares versions,
 * 'restart' simply confirms the bot is back with a fresh configuration.
 */
export function writeUpdateMarker(guildId, { channelId, requesterId, startedHead, at, kind = 'update' }) {
  setGuildData(guildId, UPDATE_MARKER_KEY, { channelId, requesterId, startedHead, at, kind });
}

export function clearUpdateMarker(guildId) {
  setGuildData(guildId, UPDATE_MARKER_KEY, null);
}

/** The marker if it exists and is fresh; stale ones are cleared and ignored. */
export function takeFreshUpdateMarker(guildId, now = Date.now()) {
  const marker = getGuildData(guildId, UPDATE_MARKER_KEY, null);
  if (!marker) return null;
  clearUpdateMarker(guildId);
  if (typeof marker.at !== 'number' || now - marker.at > MARKER_FRESH_MS) return null;
  return marker;
}

/**
 * Classify one poll tick while the process is still alive.
 * @param {string} startedHead HEAD when the update was ordered
 * @param {string} previousHead HEAD seen on the previous tick
 * @param {string} currentHead HEAD on disk right now
 * @returns {'unchanged'|'fetched'|'rolled-back'}
 *   fetched = new commits arrived (tests running; restart imminent);
 *   rolled-back = they arrived and were reverted (tests failed).
 */
export function classifyPollTick(startedHead, previousHead, currentHead) {
  if (currentHead === startedHead) {
    return previousHead !== startedHead ? 'rolled-back' : 'unchanged';
  }
  return 'fetched';
}

/**
 * How many commits origin is ahead of the local checkout — the honest answer
 * behind "already up to date". Async (execFile) so a slow network fetch never
 * blocks the gateway. Returns { behind: null } when the check itself fails
 * (network/credentials), which callers must report as "could not check", not
 * as "up to date".
 */
export async function behindOrigin(runner = null) {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = runner ?? promisify(execFile);
  const opts = { cwd: REPO_DIR, timeout: 20_000 };
  try {
    const branch = (await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], opts)).stdout.trim();
    await run('git', ['fetch', '--quiet', 'origin', branch], opts);
    const count = (await run('git', ['rev-list', '--count', `HEAD..origin/${branch}`], opts)).stdout.trim();
    return { behind: Number(count || '0') };
  } catch {
    return { behind: null };
  }
}

// ── announcing UNATTENDED updates (S117, owner: "Zodra er automatisch een
// update is geïnstalleerd laat dat weten in 412334189879230474") ─────────────
//
// `update-report.js` finishes the conversation when a HUMAN typed `!update`.
// The timer-driven path has nobody waiting on it, so nothing was ever said —
// the precinct would find out the bot had changed by noticing new behaviour.
//
// The bot announces this itself at boot rather than the shell script doing it.
// `scripts/update.sh` would need the bot token and a hand-rolled REST call to
// post anything, and the token has no business being in a shell script. The
// bot already restarts as the last step of every update, so boot is exactly
// the moment the news is true — and it covers a manual `git pull` too, which
// the script never would.

export const VERSION_MARKER_KEY = 'lastSeenVersion';

/** The owner's update-notice channel (S117, given as an id — S35: code default). */
export const DEFAULT_UPDATE_CHANNEL_ID = '412334189879230474';

/**
 * Decide what to say about the version this boot is running.
 *
 * @param {{head: string|null, subject: string|null}} current
 * @param {{head?: string}|null} stored   what the last boot recorded
 * @param {boolean} alreadyReported       true when a human `!update` already
 *                                        answered for this exact commit
 * @returns {{announce: boolean, reason: string, from: string|null, to: string|null}}
 */
export function versionChange(current, stored, alreadyReported = false) {
  const to = current?.head ?? null;
  const from = stored?.head ?? null;
  if (!to) return { announce: false, reason: 'no-git', from, to };
  // First boot ever: record and stay quiet. We cannot tell a fresh install
  // from an update, and announcing "updated!" on a brand-new checkout would
  // be a lie the very first time anyone sees this feature.
  if (!from) return { announce: false, reason: 'first-boot', from, to };
  if (from === to) return { announce: false, reason: 'unchanged', from, to };
  // A human typed `!update` and update-report.js has already told them, in
  // the channel they typed it in. Saying it again elsewhere is noise.
  if (alreadyReported) return { announce: false, reason: 'already-reported', from, to };
  return { announce: true, reason: 'updated', from, to };
}

export const getSeenVersion = (guildId) => getGuildData(guildId, VERSION_MARKER_KEY, null);

export const rememberVersion = (guildId, head) => setGuildData(guildId, VERSION_MARKER_KEY, { head });

/** The announcement text for an unattended update. */
export function updateAnnouncement({ from, to, subject }) {
  return [
    `🚔 **CuffBot updated itself** — \`${from}\` → \`${to}\``,
    subject ? `*${subject}*` : null,
    '-# Installed automatically. The test suite had to pass before this went live.',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * What the update UNIT actually did — asked, not guessed (S120).
 *
 * `!update` used to time out after three minutes and announce *"the updater
 * never ran"*. It knew no such thing: all it had observed was that `HEAD` had
 * not moved yet. On a Pi, `npm install` plus 1,087 tests takes longer than
 * three minutes, so a perfectly healthy update in progress was reported as a
 * broken one — and the owner was sent to re-run `setup-pi.sh` for nothing.
 *
 * systemd already knows the answer, so ask it.
 *
 * @returns {{known: boolean, loaded: boolean, active: string|null,
 *   result: string|null, lastRun: string|null, running: boolean}}
 */
export function updaterUnitStatus(runner = spawnSync) {
  const res = runner(
    'systemctl',
    ['show', 'cuffbot-update.service', '-p', 'LoadState', '-p', 'ActiveState', '-p', 'Result', '-p', 'ExecMainStartTimestamp'],
    { encoding: 'utf8', timeout: 10_000 },
  );
  if (res.status !== 0 || !res.stdout) {
    return { known: false, loaded: false, active: null, result: null, lastRun: null, running: false };
  }
  const fields = Object.fromEntries(
    res.stdout
      .split('\n')
      .map((line) => line.split('='))
      .filter((p) => p.length >= 2)
      .map(([k, ...v]) => [k, v.join('=').trim()]),
  );
  const active = fields.ActiveState || null;
  return {
    known: true,
    loaded: fields.LoadState === 'loaded',
    active,
    result: fields.Result || null,
    lastRun: fields.ExecMainStartTimestamp || null,
    // A Type=oneshot unit is "activating" while it runs.
    running: active === 'activating' || active === 'reloading',
  };
}

/**
 * The honest sentence for "HEAD has not moved and we are out of patience".
 *
 * Each branch says only what is actually known, and names the command that
 * settles the rest — the previous single message asserted a cause it had not
 * checked (skill 0.5.41).
 */
export function stalledUpdateReport(unit, behind, minutes) {
  if (unit.running) {
    return `⏳ Still installing after ${minutes} min — the update service is **running right now**. A full test run on a Pi takes a while; it will restart me when it goes green. Watch it: \`journalctl -u cuffbot-update -f\`.`;
  }
  if (!unit.known) {
    return `⚠️ ${behind} commit(s) behind, and I cannot query systemd from here to say why. On the Pi: \`bash scripts/update.sh\` runs it now, \`npm run doctor\` names what is broken.`;
  }
  if (!unit.loaded) {
    return `🚨 ${behind} commit(s) behind and **the \`cuffbot-update\` service is not installed**. On the Pi: \`bash scripts/setup-pi.sh\` once installs and arms it.`;
  }
  if (unit.result && unit.result !== 'success') {
    return `🚨 ${behind} commit(s) behind and the last update **failed** (\`${unit.result}\`)${unit.lastRun ? `, last run ${unit.lastRun}` : ''}. The tests probably went red and it rolled back: \`journalctl -u cuffbot-update -n 40\`.`;
  }
  return `⚠️ ${behind} commit(s) behind. The update service is installed and its last run succeeded${unit.lastRun ? ` (${unit.lastRun})` : ''}, so it most likely has not fired yet — the timer runs every 15 minutes. \`bash scripts/update.sh\` on the Pi does it now.`;
}
