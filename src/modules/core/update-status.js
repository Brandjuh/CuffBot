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

/** Remember an ordered update so the post-restart boot can report back. */
export function writeUpdateMarker(guildId, { channelId, requesterId, startedHead, at }) {
  setGuildData(guildId, UPDATE_MARKER_KEY, { channelId, requesterId, startedHead, at });
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
