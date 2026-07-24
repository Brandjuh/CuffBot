// Channel-list service: render the directory, keep the posted messages in
// sync (edit in place when possible, repost when the list grew or messages
// vanished), and debounce event-driven refreshes so a burst of channel edits
// causes exactly one update. Ported from the owner's FRA channellist cog (S36).
import { ChannelType, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildData, setGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import {
  ACTION_EDIT,
  ACTION_REPOST,
  ACTION_SKIP,
  AUTO_UPDATE_DELAY_MS,
  DEFAULT_EMBED_COLOR,
  DEFAULT_HEADER,
  EMPTY_LIST_PLACEHOLDER,
  chunkBlocks,
  decideAction,
  groupByCategory,
  renderBlocks,
} from './lib/list.js';

export const CHANNELLIST_CONFIG_KEY = 'channellistConfig';

// No default list channel: the owner has not named one (unlike the log
// channels), so the list stays unposted until an admin runs
// `/channel-list action:post channel:#…`.
export const DEFAULT_CHANNELLIST_CONFIG = {
  channelId: null,
  messageIds: [],
  messageChannelId: null,
  roleId: null, // visibility role; null = @everyone
  header: DEFAULT_HEADER,
  emoji: '',
  embedColor: DEFAULT_EMBED_COLOR,
  includeVoice: true,
  autoUpdate: true,
  ignoredIds: [],
};

export function getChannellistConfig(guildId) {
  return { ...DEFAULT_CHANNELLIST_CONFIG, ...getGuildData(guildId, CHANNELLIST_CONFIG_KEY, {}) };
}

export function setChannellistConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, CHANNELLIST_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, CHANNELLIST_CONFIG_KEY, stored);
  return { ...DEFAULT_CHANNELLIST_CONFIG, ...stored };
}

const TEXTLIKE = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum,
  ChannelType.GuildMedia,
]);
const VOICELIKE = new Set([ChannelType.GuildVoice, ChannelType.GuildStageVoice]);

/**
 * Flatten the guild's channel cache into plain descriptors for the pure
 * grouping logic. Visibility is judged for the configured role (or @everyone),
 * exactly like the FRA cog: the list shows what that role can see.
 */
export function collectDescriptors(guild, roleId) {
  const role = (roleId ? guild.roles.cache.get(roleId) : null) ?? guild.roles.everyone;
  const descriptors = [];
  for (const channel of guild.channels.cache.values()) {
    if (channel.type === ChannelType.GuildCategory) {
      descriptors.push({
        id: channel.id,
        kind: 'category',
        name: channel.name,
        parentId: null,
        position: channel.rawPosition ?? channel.position ?? 0,
        topic: null,
        visible: true,
        mention: `<#${channel.id}>`,
      });
      continue;
    }
    const kind = TEXTLIKE.has(channel.type) ? 'text' : VOICELIKE.has(channel.type) ? 'voice' : null;
    if (!kind) continue; // threads and other non-listable types
    let visible = false;
    try {
      visible = channel.permissionsFor?.(role)?.has?.(PermissionFlagsBits.ViewChannel) ?? false;
    } catch {
      visible = false;
    }
    descriptors.push({
      id: channel.id,
      kind,
      name: channel.name,
      parentId: channel.parentId ?? null,
      position: channel.rawPosition ?? channel.position ?? 0,
      topic: channel.topic ?? null,
      visible,
      mention: `<#${channel.id}>`,
    });
  }
  return descriptors;
}

/** Render the current channel structure into embed-description chunks. */
export function renderChunks(guild) {
  const config = getChannellistConfig(guild.id);
  const grouped = groupByCategory(collectDescriptors(guild, config.roleId), {
    includeVoice: config.includeVoice,
    ignoredIds: config.ignoredIds,
  });
  const chunks = chunkBlocks(config.header, renderBlocks(grouped, config.emoji));
  return chunks.length ? chunks : [EMPTY_LIST_PLACEHOLDER];
}

const embedFor = (description, color) =>
  new EmbedBuilder().setColor(color ?? DEFAULT_EMBED_COLOR).setDescription(description.slice(0, 4_096));

const embedDescription = (message) => {
  const embed = message?.embeds?.[0];
  return embed?.description ?? embed?.data?.description ?? '';
};

async function fetchExisting(channel, messageIds) {
  const messages = [];
  for (const id of messageIds) {
    try {
      messages.push(await channel.messages.fetch(id));
    } catch {
      return null; // any missing message invalidates the whole set → repost
    }
  }
  return messages;
}

async function deleteStored(guild, messageIds, messageChannelId, fetched) {
  if (fetched?.length) {
    for (const message of fetched) {
      try {
        await message.delete();
      } catch {
        /* already gone */
      }
    }
    return;
  }
  if (!messageIds?.length || !messageChannelId) return;
  const channel = guild.channels.cache.get(messageChannelId);
  if (!channel?.messages?.delete) return;
  for (const id of messageIds) {
    try {
      await channel.messages.delete(id);
    } catch {
      /* already gone */
    }
  }
}

// One refresh at a time per guild: the debounced auto-update and a manual
// command must never interleave their fetch/edit/send sequences.
const locks = new Map();
export function withListLock(guildId, fn) {
  const previous = locks.get(guildId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  locks.set(guildId, next.catch(() => {}));
  return next;
}

/**
 * Bring the posted list in line with the current channels.
 * @returns {Promise<string>} result code: unconfigured | missing-channel |
 *   forbidden | unchanged | edited | posted | reposted
 */
export async function refreshList(guild, { forceRepost = false } = {}) {
  const config = getChannellistConfig(guild.id);
  if (!config.channelId) return 'unconfigured';
  const channel = guild.channels.cache.get(config.channelId);
  if (!channel?.send) return 'missing-channel';
  const me = guild.members?.me;
  if (me && channel.permissionsFor) {
    const perms = channel.permissionsFor(me);
    if (
      perms?.has &&
      !(perms.has(PermissionFlagsBits.ViewChannel) && perms.has(PermissionFlagsBits.SendMessages))
    ) {
      return 'forbidden';
    }
  }

  const chunks = renderChunks(guild);
  const storedIds = config.messageIds ?? [];
  const existing =
    storedIds.length && config.messageChannelId === channel.id
      ? await fetchExisting(channel, storedIds)
      : null;
  const action = forceRepost
    ? ACTION_REPOST
    : decideAction(chunks, existing ? existing.map(embedDescription) : null);

  if (action === ACTION_SKIP) return 'unchanged';

  if (action === ACTION_EDIT && existing) {
    for (let index = 0; index < chunks.length && index < existing.length; index += 1) {
      if (embedDescription(existing[index]) !== chunks[index]) {
        await existing[index].edit({
          content: null,
          embeds: [embedFor(chunks[index], config.embedColor)],
          allowedMentions: { parse: [] },
        });
      }
    }
    for (const message of existing.slice(chunks.length)) {
      try {
        await message.delete();
      } catch {
        /* already gone */
      }
    }
    setChannellistConfig(guild.id, {
      messageIds: existing.slice(0, chunks.length).map((m) => m.id),
      messageChannelId: channel.id,
    });
    return 'edited';
  }

  await deleteStored(guild, storedIds, config.messageChannelId, existing);
  const newIds = [];
  for (const content of chunks) {
    const message = await channel.send({
      embeds: [embedFor(content, config.embedColor)],
      allowedMentions: { parse: [] },
    });
    newIds.push(message.id);
  }
  setChannellistConfig(guild.id, { messageIds: newIds, messageChannelId: channel.id });
  return storedIds.length ? 'reposted' : 'posted';
}

// ── automatic updates (debounced) ────────────────────────────────────────────

const pending = new Map(); // guildId → timeout

function autoUpdateReady(guildId) {
  const config = getChannellistConfig(guildId);
  return Boolean(config.autoUpdate && config.channelId && config.messageIds?.length);
}

/**
 * Debounce an automatic refresh: (re)arms a short timer so a burst of channel
 * events causes exactly one update. Only runs once a list is actually posted
 * and auto-update is on. Returns whether a refresh was scheduled.
 */
export function scheduleAutoUpdate(guild, { delayMs = AUTO_UPDATE_DELAY_MS } = {}) {
  if (!guild || !autoUpdateReady(guild.id)) return false;
  const existing = pending.get(guild.id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pending.delete(guild.id);
    if (!autoUpdateReady(guild.id)) return;
    withListLock(guild.id, () => refreshList(guild)).catch((error) =>
      logger.warn('Channel list: automatic refresh failed:', error),
    );
  }, delayMs);
  timer.unref?.();
  pending.set(guild.id, timer);
  return true;
}

export function cancelAutoUpdate(guildId) {
  const timer = pending.get(guildId);
  if (timer) clearTimeout(timer);
  pending.delete(guildId);
}

/** Delete the posted list and forget it. Returns whether there was one. */
export async function removeList(guild) {
  const config = getChannellistConfig(guild.id);
  if (!config.messageIds?.length) return false;
  cancelAutoUpdate(guild.id);
  await withListLock(guild.id, async () => {
    await deleteStored(guild, config.messageIds, config.messageChannelId, null);
    setChannellistConfig(guild.id, { messageIds: [], messageChannelId: null });
  });
  return true;
}
