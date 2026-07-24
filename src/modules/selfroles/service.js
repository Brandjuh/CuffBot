// Self-roles service (S59): detection over the live role list, the posted
// list message (tracked in the store so the bot can always edit its own
// message), per-role info texts, and the button toggle. Pure section logic
// lives in lib/selfroles.js.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { resolveSendableChannel } from '../../core/channels.js';
import { buttonLabel, renderSelfRolesLines, selectSelfRoles } from './lib/selfroles.js';

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

/** The list message: one embed + toggle buttons (5 per row). */
export function buildSelfRolesPayload(guild) {
  const detection = detectSelfRoles(guild);
  const info = getSelfrolesInfo(guild.id);
  const lines = renderSelfRolesLines(detection.roles, info);
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎭 Self roles')
    .setDescription(
      [
        'Pick your own roles — press a button to get the role, press it again to take it off.',
        '',
        ...(lines.length ? lines : ['_No self-assignable roles found under the header right now._']),
      ].join('\n'),
    );

  const rows = [];
  for (let i = 0; i < detection.roles.length; i += 5) {
    rows.push(
      new ActionRowBuilder().addComponents(
        detection.roles.slice(i, i + 5).map((role) => {
          const button = new ButtonBuilder()
            .setCustomId(`${BUTTON_PREFIX}${role.id}`)
            .setLabel(buttonLabel(role.name))
            .setStyle(ButtonStyle.Secondary);
          const emoji = getSelfrolesInfo(guild.id)[role.id]?.emoji;
          if (emoji) {
            try {
              button.setEmoji(emoji);
            } catch {
              /* invalid emoji input — the label still identifies the role */
            }
          }
          return button;
        }),
      ),
    );
  }
  return { detection, payload: { embeds: [embed], components: rows } };
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

/**
 * Bring the posted list in line with the live role list. Edits the tracked
 * message in place; posts (and remembers) a new one when there is none or it
 * was deleted — the bot can always adjust its own list (owner requirement).
 * @returns {Promise<'disabled'|'unconfigured'|'missing-channel'|'no-header'|'edited'|'posted'>}
 */
export async function refreshSelfRoles(guild) {
  return withLock(guild.id, async () => {
    const config = getSelfrolesConfig(guild.id);
    if (!config.enabled) return 'disabled';
    if (!config.channelId) return 'unconfigured';
    const channel = await resolveSendableChannel(guild, config.channelId);
    if (!channel) return 'missing-channel';

    const { detection, payload } = buildSelfRolesPayload(guild);
    if (!detection.headerFound) return 'no-header';

    const tracked = getGuildData(guild.id, SELFROLES_MESSAGE_KEY, null);
    if (tracked?.messageId && tracked.channelId === channel.id) {
      try {
        const message = await channel.messages.fetch(tracked.messageId);
        await message.edit(payload);
        return 'edited';
      } catch {
        /* deleted or unreachable — fall through to a fresh post */
      }
    }
    const posted = await channel.send(payload);
    setGuildData(guild.id, SELFROLES_MESSAGE_KEY, { channelId: channel.id, messageId: posted.id });
    return 'posted';
  });
}

// Debounced auto-refresh (15 s): role edits arrive in bursts.
const pending = new Map();
export function scheduleSelfrolesRefresh(guild, { delayMs = 15_000 } = {}) {
  const config = getSelfrolesConfig(guild.id);
  const tracked = getGuildData(guild.id, SELFROLES_MESSAGE_KEY, null);
  if (!config.enabled || !tracked?.messageId) return false; // nothing posted yet — nothing to keep current
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
