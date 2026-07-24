// Logbook service: config (channel + per-category toggles) and the single
// posting path every event handler uses. Models come from lib/logformat.js;
// this file renders and delivers them. A failing log write NEVER breaks the
// event that caused it.
import { EmbedBuilder } from 'discord.js';
import { getGuildData, setGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { CATEGORIES } from './lib/logformat.js';

export const LOGBOOK_CONFIG_KEY = 'logbookConfig';

// All categories default ON — the owner asked to "log everything"; the channel
// still has to be chosen deliberately (logs are sensitive).
export const DEFAULT_LOGBOOK_CONFIG = {
  enabled: true,
  channelId: null,
  ...Object.fromEntries(CATEGORIES.map((c) => [c, true])),
};

export function getLogbookConfig(guildId) {
  return { ...DEFAULT_LOGBOOK_CONFIG, ...getGuildData(guildId, LOGBOOK_CONFIG_KEY, {}) };
}

export function setLogbookConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, LOGBOOK_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, LOGBOOK_CONFIG_KEY, stored);
  return { ...DEFAULT_LOGBOOK_CONFIG, ...stored };
}

/**
 * Deliver one log-entry model to the logbook channel, honoring the master
 * switch, the category toggle, and never posting ABOUT the logbook channel
 * itself (deleting a message in the log must not log recursively).
 * @returns {Promise<boolean>} whether it was posted
 */
export async function postLog(guild, model, { sourceChannelId = null } = {}) {
  try {
    const config = getLogbookConfig(guild.id);
    if (!config.enabled || !config.channelId) return false;
    if (!config[model.category]) return false;
    if (sourceChannelId && sourceChannelId === config.channelId) return false;
    const channel = guild.channels.cache.get(config.channelId);
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
