// CuffBot doctor — verifies credentials AND the update chain against reality
// instead of guessing. Run with: npm run doctor   (loads .env through the same
// in-code loader the bot uses, so what the doctor sees is what the bot sees).
//
// Checks, in order:
//   1. .env raw content: quotes / whitespace / Windows line endings per key
//   2. Token shape (length, dot segments) + offline bot-id decode
//   3. Live: GET /users/@me            → is the token valid, and who is it?
//   4. Live: GET /oauth2/applications/@me → which application owns the token,
//      and does that match CLIENT_ID (the id deploy-commands registers under)?
//   5. Update chain: is the checkout behind origin? (self-updater stalled?)
//   6. Registered commands: does Discord's guild command list match the code?
//      ("a command is missing in Discord" lands here, with the exact fix)
//   7. Services (Linux): is the bot service active, is the update timer armed?
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadEnvFile } from './core/env.js';
import { analyzeSecret, botIdFromToken, diffCommandSets, tokenFingerprint } from './core/diagnostics.js';

loadEnvFile();

const API = 'https://discord.com/api/v10';
let failures = 0;

const ok = (msg) => console.log(`  ✅ ${msg}`);
const bad = (msg, fix) => {
  failures += 1;
  console.log(`  ❌ ${msg}`);
  if (fix) console.log(`     → ${fix}`);
};
const info = (msg) => console.log(`  ℹ️  ${msg}`);

console.log('🩺 CuffBot doctor — credentials & connectivity\n');

// 1) raw .env inspection (process.env may hide quote/whitespace defects)
console.log('.env file:');
if (!existsSync('.env')) {
  bad('.env does not exist in the repo root', 'cp .env.example .env and fill it in');
} else {
  const rawEnv = readFileSync('.env', 'utf8');
  for (const key of ['DISCORD_TOKEN', 'CLIENT_ID']) {
    const match = rawEnv.match(new RegExp(`^${key}\\s*=(.*)$`, 'm'));
    if (!match) {
      bad(`${key} line not found in .env`, `add a line: ${key}=…`);
      continue;
    }
    const { issues } = analyzeSecret(match[1]);
    if (issues.length === 0) ok(`${key} line looks clean`);
    else bad(`${key} ${issues.join('; ')}`, `edit .env (nano .env) so the line is exactly ${key}=<value> — no quotes, no spaces`);
  }
}

// 2) what the bot actually sees after env loading
console.log('\nParsed values (what the bot sees):');
const token = process.env.DISCORD_TOKEN ?? '';
const clientId = process.env.CLIENT_ID ?? '';
const fp = tokenFingerprint(token);
info(`DISCORD_TOKEN: length ${fp.length}, ${fp.dotParts} dot-segment(s), preview ${fp.preview}`);
if (fp.dotParts !== 3) {
  bad('a bot token has exactly 3 dot-separated segments — this value does not', 'copy the BOT token: Developer Portal → Bot → Reset Token (not the OAuth2 Client Secret, not the Public Key)');
}
if (/^\d{17,20}$/.test(clientId)) ok(`CLIENT_ID is a plausible application id (${clientId})`);
else bad(`CLIENT_ID "${clientId}" is not a 17–20 digit id`, 'use the Application ID from Developer Portal → General Information');

const decodedBotId = botIdFromToken(token);
if (decodedBotId) {
  info(`token internally identifies bot user id ${decodedBotId}`);
  if (/^\d{17,20}$/.test(clientId) && decodedBotId !== clientId) {
    info('note: that id differs from CLIENT_ID — usually fine only for very old applications; the live check below is authoritative');
  }
}

// 3+4) ask Discord itself
let liveOk = false;
console.log('\nLive checks against Discord:');
try {
  const me = await fetch(`${API}/users/@me`, { headers: { Authorization: `Bot ${token}` } });
  if (me.status === 401) {
    bad('Discord rejects this token (401 Unauthorized) — the token is simply not valid right now', 'every "Reset Token" click invalidates all older copies. Reset once more, copy the NEW value in one go, paste it into .env, save, re-run this doctor');
  } else if (!me.ok) {
    bad(
      `unexpected ${me.status} from /users/@me`,
      me.status === 403
        ? 'a proxy/filter between this machine and discord.com is likely intercepting the call — run the doctor on the machine that runs the bot'
        : 'try again in a minute; if it persists, share this output',
    );
  } else {
    liveOk = true;
    const user = await me.json();
    ok(`token is VALID — it belongs to bot "${user.username}" (id ${user.id})`);
    const app = await fetch(`${API}/oauth2/applications/@me`, { headers: { Authorization: `Bot ${token}` } });
    if (app.ok) {
      const application = await app.json();
      if (application.id === clientId) {
        ok(`CLIENT_ID matches the token's application ("${application.name}", id ${application.id})`);
      } else {
        bad(`MISMATCH: the token belongs to application "${application.name}" (id ${application.id}), but CLIENT_ID is ${clientId}`, `you have two applications mixed up — either set CLIENT_ID=${application.id} in .env, or copy the token from the application with id ${clientId}`);
      }
    } else {
      info(`could not read the token's application (${app.status}) — skipping the match check`);
    }
  }
} catch (error) {
  bad(`could not reach ${API} (${error?.cause?.code ?? error.message})`, 'check the Pi\'s internet connection / DNS, then re-run');
}

// 5) update chain: is this checkout current with origin?
console.log('\nUpdate chain (git):');
const git = (...args) => spawnSync('git', args, { encoding: 'utf8', timeout: 30_000 });
const branchRes = git('rev-parse', '--abbrev-ref', 'HEAD');
if (branchRes.status !== 0) {
  info('not a git checkout (or git unavailable) — skipping update-chain checks');
} else {
  const branch = branchRes.stdout.trim();
  const fetchRes = git('fetch', '--quiet', 'origin', branch);
  if (fetchRes.status !== 0) {
    bad(
      `git fetch origin ${branch} failed — the self-updater cannot fetch either`,
      'check the network and the stored repo credentials (private repo needs a PAT; re-run scripts/setup-pi.sh step 8)',
    );
  } else {
    const behind = Number(git('rev-list', '--count', `HEAD..origin/${branch}`).stdout.trim() || '0');
    const head = git('rev-parse', '--short', 'HEAD').stdout.trim();
    if (behind === 0) ok(`checkout is up to date with origin/${branch} (at ${head})`);
    else {
      bad(
        `checkout is ${behind} commit(s) BEHIND origin/${branch} — the self-updater has not applied them`,
        "run: sudo systemctl start cuffbot-update.service && journalctl -u cuffbot-update -n 30 --no-pager (or bash scripts/update.sh); if the timer is missing below, re-run scripts/setup-pi.sh",
      );
    }
  }
}

// 6) registered commands vs the code (the "command missing in Discord" check)
console.log('\nRegistered slash commands:');
const guildId = (() => {
  try {
    return JSON.parse(readFileSync('config.json', 'utf8')).homeGuildId;
  } catch {
    return null;
  }
})();
if (!liveOk) {
  info('skipped — fix the live token check above first');
} else if (!guildId) {
  bad('config.json → homeGuildId unreadable', 'restore config.json (it is committed — git checkout config.json)');
} else {
  try {
    const { discoverModules } = await import('./core/loader.js');
    const localNames = (await discoverModules()).flatMap((m) => m.commands.map((c) => c.data.name));
    const res = await fetch(`${API}/applications/${clientId}/guilds/${guildId}/commands`, {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!res.ok) {
      bad(
        `could not list registered commands (${res.status})`,
        res.status === 403 || res.status === 50001
          ? 'the bot may not be in the guild — invite it, then node src/deploy-commands.js'
          : 'run: node src/deploy-commands.js (it prints a specific error)',
      );
    } else {
      const registered = (await res.json()).map((c) => c.name);
      const diff = diffCommandSets(localNames, registered);
      if (diff.inSync) {
        ok(`all ${localNames.length} commands are registered and current`);
      } else {
        const parts = [];
        if (diff.missing.length) parts.push(`missing in Discord: ${diff.missing.map((n) => `/${n}`).join(', ')}`);
        if (diff.extra.length) parts.push(`stale in Discord: ${diff.extra.map((n) => `/${n}`).join(', ')}`);
        bad(
          `command registration is OUT OF SYNC — ${parts.join(' · ')}`,
          'run: node src/deploy-commands.js   (then restart Discord\'s client or wait a minute)',
        );
      }
    }
  } catch (error) {
    bad(`command comparison failed (${error.message})`, 'run: node src/deploy-commands.js and read its output');
  }
}

// 7) services (only meaningful where systemd runs the bot)
console.log('\nServices (systemd):');
const sysctl = (...args) => spawnSync('systemctl', args, { encoding: 'utf8', timeout: 10_000 });
const probe = sysctl('--version');
if (probe.error || probe.status !== 0) {
  info('systemd not available here — skipping (normal off the Pi)');
} else {
  const svc = sysctl('is-active', 'cuffbot').stdout.trim();
  if (svc === 'active') ok('cuffbot service is active (bot process is running)');
  else {
    bad(
      `cuffbot service is "${svc || 'unknown'}" — the bot is NOT running, every command will fail in Discord`,
      'sudo systemctl restart cuffbot && journalctl -u cuffbot -n 30 --no-pager (the journal names the crash)',
    );
  }
  const timerEnabled = sysctl('is-enabled', 'cuffbot-update.timer').stdout.trim();
  const timerActive = sysctl('is-active', 'cuffbot-update.timer').stdout.trim();
  if (timerEnabled === 'enabled' && timerActive === 'active') {
    ok('cuffbot-update.timer is armed (self-update every ~15 min)');
  } else {
    bad(
      `cuffbot-update.timer is ${timerEnabled || 'absent'}/${timerActive || 'inactive'} — merges will NEVER reach this machine by themselves`,
      'arm it: re-run bash scripts/setup-pi.sh (step 8 installs and enables the timer)',
    );
  }
}

console.log(failures === 0
  ? '\n🩺 All checks passed. If deploy-commands still fails, the bot is probably not a member of the precinct yet — use the invite URL it prints.'
  : `\n🩺 ${failures} problem(s) found — fix the arrows above, then re-run: npm run doctor`);
process.exit(failures === 0 ? 0 : 1);
