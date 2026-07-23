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

console.log(`Registering ${commands.length} command(s) in guild ${config.homeGuildId}…`);
const result = await rest.put(route, { body: commands });
console.log(`Done — ${result.length} command(s) registered: ${result.map((c) => `/${c.name}`).join(', ')}`);
