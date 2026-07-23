// Minimal in-code .env loader. Exists because `node --env-file` requires
// Node >= 20.6 while this project promises Node >= 18 — the owner's Pi
// proved that gap in Session 6. Loading in code removes the version cliff
// entirely and behaves the same everywhere.
import { readFileSync } from 'node:fs';

/**
 * Load KEY=VALUE pairs from a .env file into `env` (default: process.env).
 * Matching --env-file semantics where it matters: surrounding quotes are
 * stripped, CRLF tolerated, `#`-comment lines ignored, and variables already
 * present in the environment are NOT overwritten (the environment wins).
 * Missing file is not an error — config validation reports what is missing.
 * @param {string} [path]
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {boolean} whether a file was read
 */
export function loadEnvFile(path = '.env', env = process.env) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return false;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.length >= 2 && value.endsWith(quote)) {
      value = value.slice(1, -1);
    }
    if (!(match[1] in env)) env[match[1]] = value;
  }
  return true;
}
