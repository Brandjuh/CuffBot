import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import { loadEnvFile } from './core/env.js';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { loadModules } from './core/loader.js';
import { wirePrefixRouter } from './core/prefix/router.js';

loadEnvFile();
const config = loadConfig();

// One error-wrapped executor shared by the slash and text routers, so both
// invocation paths answer a crash with the same themed, ephemeral apology.
async function runCommand(command, interaction) {
  try {
    await command.execute(interaction);
  } catch (error) {
    logger.error(`Command ${command.data.name} failed:`, error);
    const apology = {
      content: '📻 Dispatch, we have a malfunction. The incident has been logged.',
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.deferred || interaction.replied) {
      await interaction.followUp(apology).catch(() => {});
    } else {
      await interaction.reply(apology).catch(() => {});
    }
  }
}

function wireSlashRouter(client) {
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) {
      logger.warn(`Unknown command "/${interaction.commandName}" — was deploy-commands run?`);
      return;
    }
    await runCommand(command, interaction);
  });
}

async function buildAndLogin(intents, { messageContent }) {
  // Partials let reaction events fire for messages sent before this boot
  // (starboard): the handler fetches the full objects on demand.
  const client = new Client({
    intents,
    partials: [Partials.Message, Partials.Reaction, Partials.Channel],
  });
  // Modules read product settings (e.g. homeGuildId, prefix) from here.
  client.config = config;
  // Features that need the Message Content intent (text commands, patrol) check
  // this so they degrade instead of misbehaving when the intent is unavailable.
  client.messageContentAvailable = messageContent;

  await loadModules(client);
  wireSlashRouter(client);
  if (messageContent) wirePrefixRouter(client, runCommand);

  try {
    await client.login(config.token);
  } catch (error) {
    await client.destroy().catch(() => {});
    throw error;
  }
  return client;
}

// The Message Content intent is privileged: it must be enabled in the Developer
// Portal or login fails. Rather than crash-loop (the systemd service restarts on
// failure), we detect that specific failure and fall back to slash-only, keeping
// the bot up while telling the owner exactly how to unlock text commands.
function isDisallowedIntents(error) {
  return error?.code === 4014 || /disallowed intents/i.test(String(error?.message ?? ''));
}

// Non-privileged intents every feature set needs: GuildMessages fires
// MessageCreate (message XP needs the event, not the content),
// GuildVoiceStates shows who is in voice (voice XP), and
// GuildMessageReactions fires the starboard's reaction events. Only
// MessageContent is privileged, so the fallback keeps everything except
// reading message text.
const BASE_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessageReactions,
];

try {
  await buildAndLogin([...BASE_INTENTS, GatewayIntentBits.MessageContent], { messageContent: true });
} catch (error) {
  if (isDisallowedIntents(error)) {
    logger.warn(
      'Message Content intent is NOT enabled — "!" text commands and patrol are DISABLED (slash commands and XP work normally). ' +
        'Enable it: Developer Portal → your app → Bot → Privileged Gateway Intents → Message Content Intent, then restart.',
    );
    await buildAndLogin(BASE_INTENTS, { messageContent: false });
  } else {
    throw error;
  }
}
