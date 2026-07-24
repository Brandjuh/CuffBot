// Logbook service: config (channel + per-category toggles) and the single
// posting path every event handler uses. Models come from lib/logformat.js;
// this file renders and delivers them. A failing log write NEVER breaks the
// event that caused it.
import { EmbedBuilder } from 'discord.js';
import { getGuildData, setGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { CATEGORIES } from './lib/logformat.js';

export const LOGBOOK_CONFIG_KEY = 'logbookConfig';

export const channelKey = (category) => `${category}ChannelId`;

// All categories default ON and the owner's log channels are committed
// per-category defaults (S35 owner decision — same pattern as the welcome
// lobby and memorial feeds), so the logbook works the moment the bot updates.
// Voice shares the member-logs channel (it is member activity); invites share
// the server-logs channel (they are server management). `/logbook` overrides
// win (sparse config).
export const DEFAULT_LOGBOOK_CONFIG = {
  enabled: true,
  channelId: null, // single-channel override: when set, EVERY category goes here
  messagesChannelId: '494216579794337802', // owner's "Message log"
  membersChannelId: '494216579136094217', // owner's "Member logs"
  moderationChannelId: '494216581216337931', // owner's "Mod logs"
  voiceChannelId: '494216579136094217', // member activity → Member logs
  serverChannelId: '494216580545380372', // owner's "Server logs"
  invitesChannelId: '494216580545380372', // server management → Server logs
  ...Object.fromEntries(CATEGORIES.map((c) => [c, true])),
};

/**
 * Which channel receives a category's entries. Precedence: an admin's explicit
 * per-category choice, then an admin's explicit single-channel override
 * (`/logbook channel:`), then the committed per-category default.
 */
export function resolveLogChannelId(guildId, category) {
  const stored = getGuildData(guildId, LOGBOOK_CONFIG_KEY, {});
  return (
    stored[channelKey(category)] ?? stored.channelId ?? DEFAULT_LOGBOOK_CONFIG[channelKey(category)] ?? null
  );
}

/** Every distinct channel the logbook currently delivers to. */
export function resolvedLogChannelIds(guildId) {
  const ids = new Set();
  for (const category of CATEGORIES) {
    const id = resolveLogChannelId(guildId, category);
    if (id) ids.add(id);
  }
  return ids;
}

export function getLogbookConfig(guildId) {
  return { ...DEFAULT_LOGBOOK_CONFIG, ...getGuildData(guildId, LOGBOOK_CONFIG_KEY, {}) };
}

export function setLogbookConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, LOGBOOK_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, LOGBOOK_CONFIG_KEY, stored);
  return { ...DEFAULT_LOGBOOK_CONFIG, ...stored };
}

/**
 * Deliver one log-entry model to its category's log channel, honoring the
 * master switch, the category toggle, and never posting ABOUT any log channel
 * (deleting old log entries must not produce new ones).
 * @returns {Promise<boolean>} whether it was posted
 */
export async function postLog(guild, model, { sourceChannelId = null } = {}) {
  try {
    const config = getLogbookConfig(guild.id);
    if (!config.enabled || !config[model.category]) return false;
    const channelId = resolveLogChannelId(guild.id, model.category);
    if (!channelId) return false;
    if (sourceChannelId && resolvedLogChannelIds(guild.id).has(sourceChannelId)) return false;
    const channel = guild.channels.cache.get(channelId);
    if (!channel?.send) return false;

    const embed = new EmbedBuilder()
      .setColor(model.color)
      .setTitle(`${model.icon} ${model.title}`)
      .setDescription(model.lines.join('\n').slice(0, 4_000))
      .setTimestamp(new Date());
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    logger.warn('Logbook: post failed:', error);
    return false;
  }
}
