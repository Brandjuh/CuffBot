// Self-roles service (S59): detection over the live role list, the posted
// list message (tracked in the store so the bot can always edit its own
// message), per-role info texts, and the button toggle. Pure section logic
// lives in lib/selfroles.js.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { resolveSendableChannel } from '../../core/channels.js';
import { BUTTONS_PER_MESSAGE, buttonLabel, renderSelfRolesLines, selectSelfRoles } from './lib/selfroles.js';

export const SELFROLES_CONFIG_KEY = 'selfrolesConfig';
export const SELFROLES_INFO_KEY = 'selfrolesInfo';
export const SELFROLES_MESSAGE_KEY = 'selfrolesMessage';
export const BUTTON_PREFIX = 'selfroles:toggle:';

// Owner decision (S59): the self-roles list lives in this channel; the roles
// come from the role list under the "self-roles" header. Sparse overrides win.
export const DEFAULT_SELFROLES_CONFIG = {
  enabled: true,
  channelId: '625276074833608705',
  headerName: 'self-roles',
};

// A self-assignable role must never carry any of these.
const ELEVATED = [
  PermissionFlagsBits.Administrator,
  PermissionFlagsBits.ManageGuild,
  PermissionFlagsBits.ManageRoles,
  PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.ManageWebhooks,
  PermissionFlagsBits.ModerateMembers,
  PermissionFlagsBits.KickMembers,
  PermissionFlagsBits.BanMembers,
  PermissionFlagsBits.MentionEveryone,
];

export function getSelfrolesConfig(guildId) {
  return { ...DEFAULT_SELFROLES_CONFIG, ...getGuildData(guildId, SELFROLES_CONFIG_KEY, {}) };
}

export function setSelfrolesConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, SELFROLES_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, SELFROLES_CONFIG_KEY, stored);
  return { ...DEFAULT_SELFROLES_CONFIG, ...stored };
}

/** { [roleId]: { text?, emoji? } } — owner-written per-role info. */
export function getSelfrolesInfo(guildId) {
  return getGuildData(guildId, SELFROLES_INFO_KEY, {});
}

export function setRoleInfo(guildId, roleId, { text, emoji } = {}) {
  return updateGuildData(
    guildId,
    SELFROLES_INFO_KEY,
    (all) => {
      const current = { ...(all[roleId] ?? {}) };
      if (text !== undefined) current.text = text;
      if (emoji !== undefined) current.emoji = emoji;
      return { ...all, [roleId]: current };
    },
    {},
  );
}

/** @returns {boolean} whether info existed */
export function clearRoleInfo(guildId, roleId) {
  let existed = false;
  updateGuildData(
    guildId,
    SELFROLES_INFO_KEY,
    (all) => {
      existed = roleId in all;
      if (!existed) return all;
      const next = { ...all };
      delete next[roleId];
      return next;
    },
    {},
  );
  return existed;
}

/** Live detection: plain role objects (highest first) → lib section rules. */
export function detectSelfRoles(guild) {
  const config = getSelfrolesConfig(guild.id);
  const rolesDesc = [...guild.roles.cache.values()]
    .sort((a, b) => b.position - a.position)
    .map((r) => ({
      id: r.id,
      name: r.name,
      managed: r.managed,
      elevated: typeof r.permissions?.any === 'function' ? r.permissions.any(ELEVATED) : false,
    }));
  return selectSelfRoles(rolesDesc, { headerName: config.headerName });
}

/**
 * The list as one or more messages (S64): Discord caps a message at 25
 * buttons (5 rows × 5), so the section is chunked — each message carries its
 * own embed (that chunk's lines) and that chunk's buttons.
 */
export function buildSelfRolesPayloads(guild) {
  const detection = detectSelfRoles(guild);
  const info = getSelfrolesInfo(guild.id);

  const toButton = (role) => {
    const button = new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${role.id}`)
      .setLabel(buttonLabel(role.name))
      .setStyle(ButtonStyle.Secondary);
    const emoji = info[role.id]?.emoji;
    if (emoji) {
      try {
        button.setEmoji(emoji);
      } catch {
        /* invalid emoji input — the label still identifies the role */
      }
    }
    return button;
  };

  const payloads = [];
  for (let start = 0; start === 0 || start < detection.roles.length; start += BUTTONS_PER_MESSAGE) {
    const chunk = detection.roles.slice(start, start + BUTTONS_PER_MESSAGE);
    const lines = renderSelfRolesLines(chunk, info);
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(start === 0 ? '🎭 Self roles' : '🎭 Self roles (continued)')
      .setDescription(
        start === 0
          ? [
              'Pick your own roles — press a button to get the role, press it again to take it off.',
              '',
              ...(lines.length ? lines : ['_No self-assignable roles found under the header right now._']),
            ].join('\n')
          : lines.join('\n'),
      );
    const rows = [];
    for (let i = 0; i < chunk.length; i += 5) {
      rows.push(new ActionRowBuilder().addComponents(chunk.slice(i, i + 5).map(toButton)));
    }
    payloads.push({ embeds: [embed], components: rows });
  }
  return { detection, payloads };
}

// One refresh at a time per guild (channellist pattern) — the debounced
// auto-update and a manual /selfroles post must never interleave.
const locks = new Map();
function withLock(guildId, fn) {
  const previous = locks.get(guildId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  locks.set(guildId, next.catch(() => {}));
  return next;
}

/** The tracked message ids, tolerating the pre-S64 single-message shape. */
function trackedMessageIds(tracked) {
  if (Array.isArray(tracked?.messageIds)) return tracked.messageIds;
  return tracked?.messageId ? [tracked.messageId] : [];
}

/**
 * Bring the posted list in line with the live role list. Since S64 the list
 * spans one message per 25 roles: each chunk edits its tracked message in
 * place, missing ones are posted, surplus ones (roster shrank) and leftovers
 * in a previously configured channel are deleted best-effort — the bot can
 * always adjust its own list (owner requirement).
 * @returns {Promise<'disabled'|'unconfigured'|'missing-channel'|'no-header'|'edited'|'posted'>}
 */
export async function refreshSelfRoles(guild) {
  return withLock(guild.id, async () => {
    const config = getSelfrolesConfig(guild.id);
    if (!config.enabled) return 'disabled';
    if (!config.channelId) return 'unconfigured';
    const channel = await resolveSendableChannel(guild, config.channelId);
    if (!channel) return 'missing-channel';

    const { detection, payloads } = buildSelfRolesPayloads(guild);
    if (!detection.headerFound) return 'no-header';

    const tracked = getGuildData(guild.id, SELFROLES_MESSAGE_KEY, null);
    const oldIds = trackedMessageIds(tracked);
    const sameChannel = tracked?.channelId === channel.id;

    const newIds = [];
    let postedAny = false;
    for (let i = 0; i < payloads.length; i += 1) {
      const existingId = sameChannel ? oldIds[i] : undefined;
      if (existingId) {
        try {
          const message = await channel.messages.fetch(existingId);
          await message.edit(payloads[i]);
          newIds.push(existingId);
          continue;
        } catch {
          /* deleted or unreachable — post a fresh one below */
        }
      }
      const sent = await channel.send(payloads[i]);
      newIds.push(sent.id);
      postedAny = true;
    }

    // Roster shrank: remove now-surplus messages.
    if (sameChannel) {
      for (const id of oldIds.slice(payloads.length)) {
        try {
          await channel.messages.delete(id);
        } catch {
          /* already gone */
        }
      }
    } else if (tracked?.channelId && oldIds.length) {
      // The list moved channels: best-effort cleanup of the old copies.
      const oldChannel = await resolveSendableChannel(guild, tracked.channelId);
      for (const id of oldIds) {
        try {
          await oldChannel?.messages?.delete(id);
        } catch {
          /* already gone */
        }
      }
    }

    setGuildData(guild.id, SELFROLES_MESSAGE_KEY, { channelId: channel.id, messageIds: newIds });
    return postedAny ? 'posted' : 'edited';
  });
}

// Debounced auto-refresh (15 s): role edits arrive in bursts.
const pending = new Map();
export function scheduleSelfrolesRefresh(guild, { delayMs = 15_000 } = {}) {
  const config = getSelfrolesConfig(guild.id);
  const tracked = getGuildData(guild.id, SELFROLES_MESSAGE_KEY, null);
  if (!config.enabled || trackedMessageIds(tracked).length === 0) return false; // nothing posted yet — nothing to keep current
  const existing = pending.get(guild.id);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pending.delete(guild.id);
    refreshSelfRoles(guild).catch((error) => logger.warn('Self roles: auto refresh failed:', error));
  }, delayMs);
  timer.unref?.();
  pending.set(guild.id, timer);
  return true;
}

/**
 * A member pressed a role button: toggle it. Validated against the LIVE
 * detection — a role that slid out of the section (or got elevated perms
 * since the post) is refused and the stale list refreshes itself.
 * @returns {Promise<{code:'added'|'removed'|'not-selfrole'|'failed', roleName?:string}>}
 */
export async function toggleSelfRole(guild, member, roleId) {
  const detection = detectSelfRoles(guild);
  const role = detection.roles.find((r) => r.id === roleId);
  if (!role) {
    scheduleSelfrolesRefresh(guild, { delayMs: 1_000 });
    return { code: 'not-selfrole' };
  }
  try {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId, 'Self role removed by the member — via CuffBot button');
      return { code: 'removed', roleName: role.name };
    }
    await member.roles.add(roleId, 'Self role picked by the member — via CuffBot button');
    return { code: 'added', roleName: role.name };
  } catch (error) {
    logger.warn(`Self roles: toggle of ${roleId} for ${member.id} failed:`, error?.message ?? error);
    return { code: 'failed', roleName: role.name };
  }
}
