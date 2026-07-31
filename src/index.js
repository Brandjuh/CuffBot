import { Client, Events, GatewayIntentBits, Partials } from 'discord.js';
import { loadEnvFile } from './core/env.js';
import { loadConfig } from './core/config.js';
import { logger } from './core/logger.js';
import { loadModules } from './core/loader.js';
import { wirePrefixRouter } from './core/prefix/router.js';
import { gracefulExit } from './modules/core/updater.js';

loadEnvFile();
const config = loadConfig();

// S68 (owner mandate): CuffBot is TEXT-ONLY — no application commands. The
// central InteractionCreate router is gone; module-owned component pumps
// (buttons/selects/modals: trivia, patrol wizard, selfroles) keep their own
// listeners — message components are not slash commands and stay.

async function buildAndLogin(intents, { messageContent, memberEvents }) {
  // Partials let reaction events fire for messages sent before this boot
  // (starboard): the handler fetches the full objects on demand.
  const client = new Client({
    intents,
    partials: [Partials.Message, Partials.Reaction, Partials.Channel, Partials.GuildMember],
  });
  // Modules read product settings (e.g. homeGuildId, prefix) from here.
  client.config = config;
  // Features that need the Message Content intent (text commands, patrol) check
  // this so they degrade instead of misbehaving when the intent is unavailable.
  client.messageContentAvailable = messageContent;
  // Same idea for the Server Members intent (welcome, logbook member trail).
  client.memberEventsAvailable = memberEvents;

  await loadModules(client);
  // S96: the router owns crash handling for both command shapes now (each
  // dispatcher answers the themed apology itself), so there is no executor
  // wrapper to hand it.
  if (messageContent) wirePrefixRouter(client);

  try {
    await client.login(config.token);
  } catch (error) {
    await client.destroy().catch(() => {});
    throw error;
  }

  // S136: `systemctl stop/restart` sends SIGTERM. Exiting through the same
  // graceful path as the self-updater lets live state (a voice session) drain
  // and leave its channel, and closes the gateway so Discord's picture of the
  // bot matches reality instead of showing a ghost in a voice channel.
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      logger.info(`${signal} received — shutting down cleanly.`);
      void gracefulExit(client);
    });
  }
  return client;
}

// The Message Content intent is privileged: it must be enabled in the Developer
// Portal or login fails. Rather than crash-loop (the systemd service restarts on
// failure), we detect that specific failure and fall back so the process stays
// up and can SAY what is wrong — in text-only mode (S68) commands are dead
// without the intent, but a live process with a loud log beats a crash loop.
function isDisallowedIntents(error) {
  return error?.code === 4014 || /disallowed intents/i.test(String(error?.message ?? ''));
}

// Non-privileged intents every feature set needs: GuildMessages fires
// MessageCreate (message XP needs the event, not the content),
// GuildVoiceStates shows who is in voice (voice XP + logbook), reactions for
// the starboard, moderation for ban logs, invites and emojis/stickers for the
// logbook's structure trail. MessageContent and GuildMembers are privileged
// and handled by the cascade below.
const BASE_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildMessageReactions,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildInvites,
  GatewayIntentBits.GuildEmojisAndStickers,
];

// Two privileged intents, each individually toggleable in the portal — try
// the richest combination first and drop whatever the portal refuses (4014
// does not say WHICH intent, hence the cascade). The bot always comes up.
const ATTEMPTS = [
  { messageContent: true, memberEvents: true },
  { messageContent: true, memberEvents: false },
  { messageContent: false, memberEvents: true },
  { messageContent: false, memberEvents: false },
];

let lastError = null;
let started = false;
for (const attempt of ATTEMPTS) {
  const intents = [
    ...BASE_INTENTS,
    ...(attempt.messageContent ? [GatewayIntentBits.MessageContent] : []),
    ...(attempt.memberEvents ? [GatewayIntentBits.GuildMembers] : []),
  ];
  try {
    await buildAndLogin(intents, attempt);
    started = true;
    if (!attempt.messageContent) {
      logger.warn(
        'Message Content intent is NOT enabled — CuffBot is TEXT-ONLY (S68), so ALL "!" commands, patrol, and @mention AI replies are DISABLED until it is. ' +
          'Enable it: Developer Portal → your app → Bot → Privileged Gateway Intents → Message Content Intent, then restart.',
      );
    }
    if (!attempt.memberEvents) {
      logger.warn(
        'Server Members intent is NOT enabled — welcome messages and the logbook member trail (joins/leaves/role changes) are DISABLED. ' +
          'Enable it: Developer Portal → your app → Bot → Privileged Gateway Intents → Server Members Intent, then restart.',
      );
    }
    break;
  } catch (error) {
    if (!isDisallowedIntents(error)) throw error;
    lastError = error;
  }
}
if (!started) throw lastError ?? new Error('Login failed for every intent combination.');
