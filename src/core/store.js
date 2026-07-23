// Per-guild JSON storage — the seam every stateful module goes through, so a
// later swap to SQLite touches one file. Writes are atomic (temp file +
// rename): a crash mid-write can never leave a half-written store. Sync IO is
// deliberate at this scale (one guild, occasional writes) — it serializes all
// access without locks.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { logger } from './logger.js';

// Tests point this at a scratch directory via CUFFBOT_DATA_DIR; read at call
// time (not import time) so setting the env var in a test file works.
function baseDir(override) {
  return override ?? process.env.CUFFBOT_DATA_DIR ?? 'data';
}

function fileFor(guildId, dir) {
  return path.join(dir, `${guildId}.json`);
}

/**
 * Read a guild's whole document. Missing file → {}. A corrupt file is moved
 * aside (never deleted — it may still be hand-recoverable) and {} returned,
 * so one bad byte cannot brick every stateful feature.
 */
export function readGuildData(guildId, { dir } = {}) {
  const file = fileFor(guildId, baseDir(dir));
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    const backup = `${file}.corrupt-${Date.now()}`;
    try {
      renameSync(file, backup);
      logger.error(`Store: ${file} is corrupt (${error.message}) — moved to ${backup}, starting fresh.`);
    } catch {
      logger.error(`Store: ${file} is corrupt and could not be moved aside — starting fresh in memory.`);
    }
    return {};
  }
}

/** Get one key with a fallback. */
export function getGuildData(guildId, key, fallback, options = {}) {
  const doc = readGuildData(guildId, options);
  return key in doc ? doc[key] : fallback;
}

/** Set one key, atomically persisting the whole document. */
export function setGuildData(guildId, key, value, options = {}) {
  const dir = baseDir(options.dir);
  mkdirSync(dir, { recursive: true });
  const doc = readGuildData(guildId, options);
  doc[key] = value;
  const file = fileFor(guildId, dir);
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`);
  renameSync(tmp, file);
  return value;
}

/**
 * Read-modify-write one key in a single call so compound state (like a case
 * counter plus its entries) stays consistent.
 * @param {(current: any) => any} updater receives current value (or fallback)
 * @returns the updated value
 */
export function updateGuildData(guildId, key, updater, fallback, options = {}) {
  const current = getGuildData(guildId, key, fallback, options);
  return setGuildData(guildId, key, updater(current), options);
}
