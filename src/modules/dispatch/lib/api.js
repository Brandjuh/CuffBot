// Dispatch API — the seam other modules call to log to the evidence locker.
// Store access and formatting stay simple; the channel resolution needs live
// Discord objects, so this file imports discord.js (it is an integration lib,
// not a pure one). Callers wrap every call in try/catch: a logging problem must
// never block the moderation action that triggered it.
import { PermissionFlagsBits } from 'discord.js';
import { getGuildData, setGuildData } from '../../../core/store.js';
import { enforcementEmbed } from './format.js';

const KEY = 'evidenceLockerChannelId';

export function getEvidenceLocker(guildId, options = {}) {
  return getGuildData(guildId, KEY, null, options);
}
export function setEvidenceLocker(guildId, channelId, options = {}) {
  return setGuildData(guildId, KEY, channelId, options);
}
export function clearEvidenceLocker(guildId, options = {}) {
  return setGuildData(guildId, KEY, null, options);
}

/**
 * Resolve the configured evidence-locker channel, or say why it is unavailable.
 * @returns {Promise<{ channel: object|null, reason: string|null }>}
 *   reason ∈ 'not-configured' | 'channel-missing' | 'no-permission'
 */
export async function resolveLocker(guild) {
  const id = getEvidenceLocker(guild.id);
  if (!id) return { channel: null, reason: 'not-configured' };
  const channel = guild.channels.cache?.get(id) ?? (await guild.channels.fetch(id).catch(() => null));
  if (!channel || typeof channel.send !== 'function') return { channel: null, reason: 'channel-missing' };
  const me = guild.members?.me;
  const perms = me && channel.permissionsFor ? channel.permissionsFor(me) : null;
  if (perms && !perms.has(PermissionFlagsBits.SendMessages)) {
    return { channel: null, reason: 'no-permission' };
  }
  return { channel, reason: null };
}

/**
 * Post an enforcement action to the evidence locker (best effort).
 * @param {object} guild
 * @param {{ type, subject, officer, reason?, caseNumber?, fields? }} action
 * @returns {Promise<{ delivered: boolean, reason: string|null }>}
 */
export async function logEnforcement(guild, action) {
  const { channel, reason } = await resolveLocker(guild);
  if (!channel) return { delivered: false, reason };
  const ok = await channel
    .send({ embeds: [enforcementEmbed(action)] })
    .then(() => true)
    .catch(() => false);
  return { delivered: ok, reason: ok ? null : 'send-failed' };
}
