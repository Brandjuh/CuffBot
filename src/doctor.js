// CuffBot doctor — verifies credentials against reality instead of guessing.
// Run with: npm run doctor   (loads .env the same way the bot does, so what
// the doctor sees is exactly what the bot sees).
//
// Checks, in order:
//   1. .env raw content: quotes / whitespace / Windows line endings per key
//   2. Token shape (length, dot segments) + offline bot-id decode
//   3. Live: GET /users/@me            → is the token valid, and who is it?
//   4. Live: GET /oauth2/applications/@me → which application owns the token,
//      and does that match CLIENT_ID (the id deploy-commands registers under)?
import { existsSync, readFileSync } from 'node:fs';
import { analyzeSecret, botIdFromToken, tokenFingerprint } from './core/diagnostics.js';

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

// 2) what the bot actually sees after --env-file parsing
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

console.log(failures === 0
  ? '\n🩺 All checks passed. If deploy-commands still fails, the bot is probably not a member of the precinct yet — use the invite URL it prints.'
  : `\n🩺 ${failures} problem(s) found — fix the arrows above, then re-run: npm run doctor`);
process.exit(failures === 0 ? 0 : 1);
