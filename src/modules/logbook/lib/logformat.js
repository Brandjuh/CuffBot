// Pure log-entry models for the station logbook — no discord.js. Every server
// event becomes a small {category, icon, title, lines[], color} model that the
// service renders into one embed. Categories are the toggle units.

export const CATEGORIES = ['messages', 'members', 'moderation', 'voice', 'server', 'invites'];

const COLORS = {
  messages: 0xe67e22,
  members: 0x27ae60,
  moderation: 0xc0392b,
  voice: 0x2980b9,
  server: 0x8e44ad,
  invites: 0x16a085,
};

function clamp(text, max = 900) {
  const t = String(text ?? '').trim();
  if (t.length === 0) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

const entry = (category, icon, title, lines) => ({
  category,
  icon,
  title,
  lines: lines.filter(Boolean),
  color: COLORS[category],
});

// ── messages ─────────────────────────────────────────────────────────────────

export function messageDeleted({ authorTag, authorId, channelId, content, attachmentCount, partial }) {
  return entry('messages', '🗑️', 'Message deleted', [
    partial
      ? `In <#${channelId}> — the message was not in my cache, so author and content are unknown.`
      : `By **${authorTag}** (<@${authorId}>) in <#${channelId}>`,
    content ? `**Content:** ${clamp(content)}` : partial ? null : '**Content:** _(empty or embed-only)_',
    attachmentCount ? `**Attachments:** ${attachmentCount}` : null,
  ]);
}

export function messageEdited({ authorTag, authorId, channelId, before, after, url }) {
  return entry('messages', '✏️', 'Message edited', [
    `By **${authorTag}** (<@${authorId}>) in <#${channelId}>${url ? ` — [jump](${url})` : ''}`,
    `**Before:** ${clamp(before) ?? '_(unknown — not cached)_'}`,
    `**After:** ${clamp(after) ?? '_(empty)_'}`,
  ]);
}

export function messagesBulkDeleted({ count, channelId }) {
  return entry('messages', '🧹', 'Messages bulk-deleted', [`**${count}** messages removed in <#${channelId}>.`]);
}

// ── members ──────────────────────────────────────────────────────────────────

export function memberJoined({ userTag, userId, accountAgeDays }) {
  return entry('members', '📥', 'Member joined', [
    `**${userTag}** (<@${userId}>)`,
    accountAgeDays != null ? `**Account age:** ${accountAgeDays} day${accountAgeDays === 1 ? '' : 's'}` : null,
  ]);
}

export function memberLeft({ userTag, userId, roleNames }) {
  return entry('members', '📤', 'Member left', [
    `**${userTag}** (<@${userId}>)`,
    roleNames?.length ? `**Roles held:** ${clamp(roleNames.join(', '), 400)}` : null,
  ]);
}

export function nicknameChanged({ userTag, userId, before, after }) {
  return entry('members', '🏷️', 'Nickname changed', [
    `**${userTag}** (<@${userId}>)`,
    `**Before:** ${before ?? '_(none)_'} → **After:** ${after ?? '_(none)_'}`,
  ]);
}

export function rolesChanged({ userTag, userId, added, removed }) {
  return entry('members', '🎖️', 'Roles changed', [
    `**${userTag}** (<@${userId}>)`,
    added?.length ? `**Added:** ${clamp(added.join(', '), 400)}` : null,
    removed?.length ? `**Removed:** ${clamp(removed.join(', '), 400)}` : null,
  ]);
}

// ── moderation ───────────────────────────────────────────────────────────────

export function memberBanned({ userTag, userId, reason }) {
  return entry('moderation', '🔨', 'Member banned', [
    `**${userTag}** (<@${userId}>)`,
    reason ? `**Reason:** ${clamp(reason, 400)}` : null,
  ]);
}

export function memberUnbanned({ userTag, userId }) {
  return entry('moderation', '🔓', 'Member unbanned', [`**${userTag}** (<@${userId}>)`]);
}

// ── voice ────────────────────────────────────────────────────────────────────

export function voiceChanged({ userTag, userId, fromChannelId, toChannelId }) {
  if (!fromChannelId && toChannelId) {
    return entry('voice', '🎙️', 'Voice joined', [`**${userTag}** (<@${userId}>) joined <#${toChannelId}>`]);
  }
  if (fromChannelId && !toChannelId) {
    return entry('voice', '🔇', 'Voice left', [`**${userTag}** (<@${userId}>) left <#${fromChannelId}>`]);
  }
  return entry('voice', '🔀', 'Voice moved', [
    `**${userTag}** (<@${userId}>): <#${fromChannelId}> → <#${toChannelId}>`,
  ]);
}

// ── server (channels / roles / emojis) ───────────────────────────────────────

export function channelChanged({ action, channelId, name, beforeName }) {
  const titles = { create: 'Channel created', delete: 'Channel deleted', rename: 'Channel renamed' };
  return entry('server', '📁', titles[action] ?? 'Channel changed', [
    action === 'delete' ? `**#${name}**` : `<#${channelId}>`,
    action === 'rename' ? `**Before:** #${beforeName} → **After:** #${name}` : null,
  ]);
}

export function roleChanged({ action, name, beforeName }) {
  const titles = { create: 'Role created', delete: 'Role deleted', rename: 'Role renamed' };
  return entry('server', '🛡️', titles[action] ?? 'Role changed', [
    `**${action === 'rename' ? beforeName : name}**${action === 'rename' ? ` → **${name}**` : ''}`,
  ]);
}

export function emojiChanged({ action, name }) {
  return entry('server', '😀', action === 'create' ? 'Emoji added' : 'Emoji removed', [`\`:${name}:\``]);
}

// ── invites ──────────────────────────────────────────────────────────────────

export function inviteChanged({ action, code, channelId, inviterTag }) {
  return entry('invites', '🎟️', action === 'create' ? 'Invite created' : 'Invite deleted', [
    `**Code:** \`${code}\`${channelId ? ` → <#${channelId}>` : ''}`,
    inviterTag ? `**By:** ${inviterTag}` : null,
  ]);
}
