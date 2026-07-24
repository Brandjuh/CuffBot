// Welcome service: greet new members in the lobby. Config in the guild store;
// the owner's lobby is the committed default (S34 owner decision, same pattern
// as the chat starter and birthdays).
import { getGuildData, setGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';

export const WELCOME_CONFIG_KEY = 'welcomeConfig';
export const DEFAULT_WELCOME_CONFIG = {
  enabled: true,
  channelId: '411609312037961729', // owner's lobby (S34)
  // {user} → mention, {server} → guild name. Editable via /welcome-config.
  message:
    '🚔 **Welcome to the precinct, {user}!** Report to the front desk, grab a coffee ☕ and a donut 🍩 — and enjoy your stay at **{server}**.',
};

export function getWelcomeConfig(guildId) {
  return { ...DEFAULT_WELCOME_CONFIG, ...getGuildData(guildId, WELCOME_CONFIG_KEY, {}) };
}

export function setWelcomeConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, WELCOME_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, WELCOME_CONFIG_KEY, stored);
  return { ...DEFAULT_WELCOME_CONFIG, ...stored };
}

/** Render the welcome text for a member (pure string work). */
export function renderWelcome(template, { userMention, serverName }) {
  return String(template ?? '')
    .replaceAll('{user}', userMention)
    .replaceAll('{server}', serverName)
    .slice(0, 1_900);
}

/**
 * Post the welcome for a member. Never pings: the {user} mention renders as a
 * highlighted name but sends NO notification (S35 owner decision). Returns
 * whether a message was sent (silent no-op when disabled/unconfigured/unsendable).
 */
export async function postWelcome(guild, userId, { displayName } = {}) {
  const config = getWelcomeConfig(guild.id);
  if (!config.enabled || !config.channelId) return false;
  const channel = guild.channels.cache.get(config.channelId);
  if (!channel?.send) return false;
  try {
    await channel.send({
      content: renderWelcome(config.message, {
        userMention: `<@${userId}>`,
        serverName: guild.name ?? 'the precinct',
      }),
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (error) {
    logger.warn(`Welcome: post failed for ${displayName ?? userId}:`, error);
    return false;
  }
}
