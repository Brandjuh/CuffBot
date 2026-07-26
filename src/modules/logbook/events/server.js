// Structure trail: voice movement, channels, roles, emojis, invites. Voice
// logs only join/leave/move (mute/deafen toggles would be pure noise).
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import {
  channelChanged,
  channelPermissionsChanged,
  emojiChanged,
  inviteChanged,
  roleChanged,
  rolePermissionsChanged,
  voiceChanged,
} from '../lib/logformat.js';
import { describeOverwrite, diffOverwrites, diffPermissions, overwriteSnapshot } from '../lib/permissions.js';
import { postLog } from '../service.js';

const isHome = (guild, client) => guild && guild.id === client.config.homeGuildId;
const guard = (label, fn) => async (...args) => {
  try {
    await fn(...args);
  } catch (error) {
    logger.warn(`Logbook: ${label} log failed:`, error);
  }
};

export const onVoiceState = {
  name: Events.VoiceStateUpdate,
  execute: guard('voice', async (oldState, newState) => {
    if (!isHome(newState.guild, newState.client)) return;
    if (oldState.channelId === newState.channelId) return; // mute/deaf toggles
    const member = newState.member ?? oldState.member;
    if (member?.user?.bot) return;
    await postLog(
      newState.guild,
      voiceChanged({
        userTag: member?.user?.tag ?? member?.user?.username ?? 'unknown',
        userId: member?.id,
        fromChannelId: oldState.channelId,
        toChannelId: newState.channelId,
      }),
    );
  }),
};

export const onChannelCreate = {
  name: Events.ChannelCreate,
  execute: guard('channel-create', async (channel) => {
    if (!isHome(channel.guild, channel.client)) return;
    await postLog(channel.guild, channelChanged({ action: 'create', channelId: channel.id, name: channel.name }));
  }),
};

export const onChannelDelete = {
  name: Events.ChannelDelete,
  execute: guard('channel-delete', async (channel) => {
    if (!isHome(channel.guild, channel.client)) return;
    await postLog(channel.guild, channelChanged({ action: 'delete', channelId: channel.id, name: channel.name }));
  }),
};

export const onChannelUpdate = {
  name: Events.ChannelUpdate,
  execute: guard('channel-update', async (oldChannel, newChannel) => {
    if (!isHome(newChannel.guild, newChannel.client)) return;

    if (oldChannel.name !== newChannel.name) {
      await postLog(
        newChannel.guild,
        channelChanged({
          action: 'rename',
          channelId: newChannel.id,
          name: newChannel.name,
          beforeName: oldChannel.name,
        }),
      );
    }

    // S113. Until now this handler returned early on anything that was not a
    // rename, with the comment "topic/permission edits are noise" — so every
    // permission change on every channel went unlogged. A topic edit really is
    // noise; who may read a channel is not.
    const changes = diffOverwrites(overwriteSnapshot(oldChannel), overwriteSnapshot(newChannel));
    if (changes.length === 0) return;
    await postLog(
      newChannel.guild,
      channelPermissionsChanged({
        channelId: newChannel.id,
        name: newChannel.name,
        descriptions: changes.map(describeOverwrite),
      }),
    );
  }),
};

export const onRoleCreate = {
  name: Events.GuildRoleCreate,
  execute: guard('role-create', async (role) => {
    if (!isHome(role.guild, role.client)) return;
    await postLog(role.guild, roleChanged({ action: 'create', name: role.name }));
  }),
};

export const onRoleDelete = {
  name: Events.GuildRoleDelete,
  execute: guard('role-delete', async (role) => {
    if (!isHome(role.guild, role.client)) return;
    await postLog(role.guild, roleChanged({ action: 'delete', name: role.name }));
  }),
};

export const onRoleUpdate = {
  name: Events.GuildRoleUpdate,
  execute: guard('role-update', async (oldRole, newRole) => {
    if (!isHome(newRole.guild, newRole.client)) return;

    if (oldRole.name !== newRole.name) {
      await postLog(newRole.guild, roleChanged({ action: 'rename', name: newRole.name, beforeName: oldRole.name }));
    }

    // S113: a rename used to be the only thing this handler reported, so
    // granting a role Administrator produced no log line at all.
    const diff = diffPermissions(oldRole.permissions?.bitfield, newRole.permissions?.bitfield);
    if (!diff.changed) return;
    await postLog(
      newRole.guild,
      rolePermissionsChanged({
        roleId: newRole.id,
        name: newRole.name,
        added: diff.added,
        removed: diff.removed,
      }),
    );
  }),
};

export const onEmojiCreate = {
  name: Events.GuildEmojiCreate,
  execute: guard('emoji-create', async (emoji) => {
    if (!isHome(emoji.guild, emoji.client)) return;
    await postLog(emoji.guild, emojiChanged({ action: 'create', name: emoji.name }));
  }),
};

export const onEmojiDelete = {
  name: Events.GuildEmojiDelete,
  execute: guard('emoji-delete', async (emoji) => {
    if (!isHome(emoji.guild, emoji.client)) return;
    await postLog(emoji.guild, emojiChanged({ action: 'delete', name: emoji.name }));
  }),
};

export const onInviteCreate = {
  name: Events.InviteCreate,
  execute: guard('invite-create', async (invite) => {
    if (!isHome(invite.guild, invite.client)) return;
    await postLog(
      invite.guild,
      inviteChanged({
        action: 'create',
        code: invite.code,
        channelId: invite.channelId,
        inviterTag: invite.inviter?.tag ?? invite.inviter?.username ?? null,
      }),
    );
  }),
};

export const onInviteDelete = {
  name: Events.InviteDelete,
  execute: guard('invite-delete', async (invite) => {
    if (!isHome(invite.guild, invite.client)) return;
    await postLog(invite.guild, inviteChanged({ action: 'delete', code: invite.code, channelId: invite.channelId }));
  }),
};
