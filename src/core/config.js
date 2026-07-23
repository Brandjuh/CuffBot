// Configuration loading with fail-fast validation: a missing token should be
// diagnosed in seconds at boot, not as a cryptic login error later.
// Secrets come from the environment (.env, loaded in code by core/env.js —
// callers run loadEnvFile() first); non-secret product settings (the home
// guild) live in config.json and are committed.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_ENV = ['DISCORD_TOKEN', 'CLIENT_ID'];
const SNOWFLAKE = /^\d{17,20}$/;

const settingsPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'config.json',
);

/**
 * Load and validate configuration.
 * @param {{ env?: NodeJS.ProcessEnv, settingsFile?: string }} [options] test seams
 * @returns {{ token: string, clientId: string, homeGuildId: string }}
 */
export function loadConfig({ env = process.env, settingsFile = settingsPath } = {}) {
  const missing = REQUIRED_ENV.filter((key) => !env[key] || String(env[key]).trim() === '');
  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill in the values (see README → Quickstart).',
    );
  }

  let settings;
  try {
    settings = JSON.parse(readFileSync(settingsFile, 'utf8'));
  } catch (cause) {
    throw new Error(`Could not read settings from ${settingsFile}: ${cause.message}`, { cause });
  }

  if (!SNOWFLAKE.test(String(settings.homeGuildId ?? ''))) {
    throw new Error(
      'config.json → homeGuildId must be a Discord guild id (17–20 digits). ' +
        'CuffBot serves exactly one precinct; set its guild id there.',
    );
  }

  // Prefix for text ("!command") invocation. A single non-space, non-slash
  // character keeps parsing unambiguous and avoids clashing with slash commands.
  const prefix = String(settings.prefix ?? '!');
  if (prefix.length !== 1 || /\s|\//.test(prefix)) {
    throw new Error(
      'config.json → prefix must be a single character and not whitespace or "/". ' +
        `Got ${JSON.stringify(settings.prefix)}.`,
    );
  }

  return {
    token: env.DISCORD_TOKEN,
    clientId: env.CLIENT_ID,
    homeGuildId: String(settings.homeGuildId),
    prefix,
  };
}
