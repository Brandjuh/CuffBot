import { Client, Events, GatewayIntentBits, MessageFlags } from 'discord.js';
import { loadEnvFile } from './core/env.js';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { loadModules } from './core/loader.js';

loadEnvFile();
const config = loadConfig();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
// Modules read product settings (e.g. homeGuildId) from here instead of
// re-loading config themselves.
client.config = config;

await loadModules(client);

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = client.commands.get(interaction.commandName);
  if (!command) {
    logger.warn(`Unknown command "/${interaction.commandName}" — was deploy-commands run?`);
    return;
  }
  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Command /${interaction.commandName} failed:`, error);
    const apology = {
      content: '📻 Dispatch, we have a malfunction. The incident has been logged.',
      flags: MessageFlags.Ephemeral,
    };
    // The interaction may or may not have been answered before the throw —
    // pick the variant that cannot double-reply.
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(apology).catch(() => {});
    } else {
      await interaction.reply(apology).catch(() => {});
    }
  }
});

client.login(config.token);
