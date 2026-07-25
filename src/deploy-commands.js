// S68 (owner mandate): CuffBot is TEXT-ONLY — every command is a `!command`.
// This script now DE-registers: it PUTs an empty application-command roster
// for the home guild so previously registered slash commands disappear from
// Discord's UI. The self-update chain (scripts/update.sh) already runs this
// on every update, so the live bot clears itself without manual steps.
import { REST, Routes } from 'discord.js';
import { loadEnvFile } from './core/env.js';
import { loadConfig } from './core/config.js';

loadEnvFile();
const config = loadConfig();

const rest = new REST().setToken(config.token);
const route = Routes.applicationGuildCommands(config.clientId, config.homeGuildId);
const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${config.clientId}&scope=bot%20applications.commands&permissions=2048`;

console.log(`Text-only mode (S68): clearing all application commands in guild ${config.homeGuildId}…`);
try {
  const result = await rest.put(route, { body: [] });
  console.log(
    result.length === 0
      ? 'Done — no slash commands registered. Every command runs as !command.'
      : `Unexpected: ${result.length} command(s) still registered.`,
  );
} catch (error) {
  const apiCode = error?.rawError?.code ?? error?.code;
  const status = error?.status;
  if (apiCode === 50001) {
    console.error(`\n❌ Missing Access: the bot is not a member of the home precinct (${config.homeGuildId}) yet.`);
    console.error(`   Invite it first: ${inviteUrl}`);
  } else if (status === 401) {
    console.error('\n❌ Unauthorized: DISCORD_TOKEN is wrong or was rotated. Update .env and retry.');
  } else if (status === 404) {
    console.error('\n❌ Not Found: CLIENT_ID does not match this bot application. Check .env.');
  } else {
    console.error('\n❌ Clearing application commands failed:', error?.message ?? error);
  }
  process.exitCode = 1;
}
