// Keeps the posted channel list current. Structural changes (channels, role
// permissions) debounce into one refresh; deleting a list message triggers a
// repost; boot catches up on changes that happened while the bot was offline.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import {
  getChannellistConfig,
  refreshList,
  scheduleAutoUpdate,
  withListLock,
} from '../service.js';

const isHome = (guild, client) => guild && guild.id === client.config.homeGuildId;
const guard = (label, fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (error) {
    logger.warn(`Channel list: ${label} failed:`, error);
  }
};

const serializeOverwrites = (channel) =>
  [...(channel.permissionOverwrites?.cache?.values() ?? [])]
    .map((o) => `${o.id}:${o.allow?.bitfield ?? ''}:${o.deny?.bitfield ?? ''}`)
    .sort()
    .join('|');

export const onChannelCreate = {
  name: Events.ChannelCreate,
  execute: guard('channel-create watch', async (channel) => {
    if (isHome(channel.guild, channel.client)) scheduleAutoUpdate(channel.guild);
  }),
};

export const onChannelDelete = {
  name: Events.ChannelDelete,
  execute: guard('channel-delete watch', async (channel) => {
    if (isHome(channel.guild, channel.client)) scheduleAutoUpdate(channel.guild);
  }),
};

export const onChannelUpdate = {
  name: Events.ChannelUpdate,
  execute: guard('channel-update watch', async (before, after) => {
    if (!isHome(after.guild, after.client)) return;
    const moved =
      before.name !== after.name ||
      (before.rawPosition ?? before.position) !== (after.rawPosition ?? after.position) ||
      (before.parentId ?? null) !== (after.parentId ?? null) ||
      (before.topic ?? null) !== (after.topic ?? null) ||
      serializeOverwrites(before) !== serializeOverwrites(after);
    if (moved) scheduleAutoUpdate(after.guild);
  }),
};

export const onRoleUpdate = {
  name: Events.GuildRoleUpdate,
  execute: guard('role-update watch', async (before, after) => {
    if (!isHome(after.guild, after.client)) return;
    if (before.permissions?.bitfield !== after.permissions?.bitfield) {
      scheduleAutoUpdate(after.guild);
    }
  }),
};

export const onRoleDelete = {
  name: Events.GuildRoleDelete,
  execute: guard('role-delete watch', async (role) => {
    if (isHome(role.guild, role.client)) scheduleAutoUpdate(role.guild);
  }),
};

export const onListMessageDelete = {
  name: Events.MessageDelete,
  execute: guard('message-delete watch', async (message) => {
    const guild = message.guild;
    if (!guild || !isHome(guild, message.client)) return;
    const config = getChannellistConfig(guild.id);
    if (config.messageIds?.includes(message.id)) scheduleAutoUpdate(guild);
  }),
};

export const onListBulkDelete = {
  name: Events.MessageBulkDelete,
  execute: guard('bulk-delete watch', async (messages, channel) => {
    const guild = channel?.guild;
    if (!guild || !isHome(guild, channel.client)) return;
    const stored = new Set(getChannellistConfig(guild.id).messageIds ?? []);
    if (stored.size === 0) return;
    for (const id of messages.keys()) {
      if (stored.has(id)) {
        scheduleAutoUpdate(guild);
        return;
      }
    }
  }),
};

export const onBootCatchUp = {
  name: Events.ClientReady,
  execute: guard('boot catch-up', async (client) => {
    const guild = client.guilds.cache.get(client.config.homeGuildId);
    if (!guild) return;
    const config = getChannellistConfig(guild.id);
    if (!(config.autoUpdate && config.channelId && config.messageIds?.length)) return;
    await withListLock(guild.id, () => refreshList(guild));
  }),
};
