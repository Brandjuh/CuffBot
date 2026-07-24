// Starboard service: config + boarded-store access and the boarding action.
// Rules live in lib/board.js; the reaction event calls into here.
import { EmbedBuilder } from 'discord.js';
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { boardModel, DEFAULT_STARBOARD_CONFIG, isBoarded, recordBoarded } from './lib/board.js';

export const STARBOARD_CONFIG_KEY = 'starboardConfig';
export const STARBOARD_POSTED_KEY = 'starboardPosted';

export function getStarboardConfig(guildId) {
  return { ...DEFAULT_STARBOARD_CONFIG, ...getGuildData(guildId, STARBOARD_CONFIG_KEY, {}) };
}

export function setStarboardConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, STARBOARD_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, STARBOARD_CONFIG_KEY, stored);
  return { ...DEFAULT_STARBOARD_CONFIG, ...stored };
}

export function getBoardedData(guildId) {
  return getGuildData(guildId, STARBOARD_POSTED_KEY, {});
}

export function alreadyBoarded(guildId, messageId) {
  return isBoarded(getBoardedData(guildId), messageId);
}

export function starboardEmbed(model) {
  const embed = new EmbedBuilder()
    .setColor(0xf5b041)
    .setAuthor({ name: model.authorName, ...(model.avatarUrl ? { iconURL: model.avatarUrl } : {}) })
    .setDescription(`${model.content}\n\n[Jump to the original](${model.jumpUrl}) · <#${model.channelId}>`)
    .setFooter({ text: `⭐ ${model.stars} — Commendation Board` });
  if (model.imageUrl) embed.setImage(model.imageUrl);
  return embed;
}

/**
 * Post a message snapshot to the board channel and record it. Claims the
 * message BEFORE sending (synchronous store write) so two near-simultaneous
 * reactions can never double-post; on a failed send the claim is rolled back
 * so a later star retries.
 * @returns {Promise<boolean>} whether it was posted
 */
export async function boardMessage(guild, snap, config) {
  const channel = guild.channels.cache.get(config.channelId);
  if (!channel?.send) return false;

  let claimed = false;
  updateGuildData(
    guild.id,
    STARBOARD_POSTED_KEY,
    (data) => {
      if (isBoarded(data, snap.messageId)) return data;
      claimed = true;
      return recordBoarded(data, snap.messageId, 'pending');
    },
    {},
  );
  if (!claimed) return false;

  try {
    const posted = await channel.send({
      embeds: [starboardEmbed(boardModel(snap))],
      allowedMentions: { parse: [] },
    });
    updateGuildData(
      guild.id,
      STARBOARD_POSTED_KEY,
      (data) => recordBoarded(data, snap.messageId, posted?.id ?? 'posted'),
      {},
    );
    return true;
  } catch {
    // Roll the claim back so a later reaction can retry.
    updateGuildData(
      guild.id,
      STARBOARD_POSTED_KEY,
      (data) => {
        const posts = { ...(data.posts ?? {}) };
        delete posts[snap.messageId];
        return { order: (data.order ?? []).filter((id) => id !== snap.messageId), posts };
      },
      {},
    );
    return false;
  }
}
