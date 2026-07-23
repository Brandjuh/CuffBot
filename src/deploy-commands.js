// Registers all module slash commands with Discord — guild-scoped to the home
// precinct only. Guild-scoped registration is instant, and a one-precinct bot
// has no reason to register commands globally.
import { REST, Routes } from 'discord.js';
import { loadConfig } from './core/config.js';
import { discoverModules } from './core/loader.js';

const config = loadConfig();
const modules = await discoverModules();
const commands = modules.flatMap((mod) => mod.commands.map((cmd) => cmd.data.toJSON()));

const rest = new REST().setToken(config.token);
const route = Routes.applicationGuildCommands(config.clientId, config.homeGuildId);
const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${config.clientId}&scope=bot%20applications.commands&permissions=2048`;

console.log(`Registering ${commands.length} command(s) in guild ${config.homeGuildId}…`);
try {
  const result = await rest.put(route, { body: commands });
  console.log(
    `Done — ${result.length} command(s) registered: ${result.map((c) => `/${c.name}`).join(', ')}`,
  );
} catch (error) {
  // Translate the three real-world failure modes into instructions; the raw
  // error alone sent the first live deploy (S4) down the wrong path.
  const apiCode = error?.rawError?.code ?? error?.code;
  const status = error?.status;
  if (apiCode === 50001) {
    console.error(`\n❌ Missing Access: the bot is not a member of the home precinct (${config.homeGuildId}) yet.`);
    console.error('   Invite it first (you need Manage Server in that guild), then re-run:');
    console.error(`   ${inviteUrl}\n`);
  } else if (status === 401) {
    console.error('\n❌ Unauthorized: DISCORD_TOKEN is wrong or has been reset.');
    console.error('   Use the BOT token (Developer Portal → Bot → Reset Token) — not the OAuth2 Client Secret — and update .env.\n');
  } else if (apiCode === 10002) {
    console.error('\n❌ Unknown application: CLIENT_ID does not match an application.');
    console.error('   Use the Application ID from Developer Portal → General Information, and update .env.\n');
  } else {
    console.error('\n❌ Command registration failed with an unexpected error:');
    console.error(error);
    console.error(`\n   If the bot is not in the precinct yet, invite it first: ${inviteUrl}\n`);
  }
  process.exit(1);
}
