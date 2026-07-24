// Pure starboard rules — no discord.js. Decides WHETHER a reaction event
// boards a message and WHAT the board post looks like, from plain values.

export const DEFAULT_STARBOARD_CONFIG = {
  enabled: true,
  channelId: null,
  threshold: 3, // stars needed
  emoji: '⭐',
};

/**
 * Should this reaction state put the message on the board? The configured
 * emoji is either a unicode character (matched against the reaction NAME) or
 * a custom-emoji ID (matched against the reaction ID — names are not unique).
 * @returns {{ board:true } | { board:false, reason:string }}
 */
export function shouldBoard({
  emojiName,
  emojiId = null,
  count,
  config,
  messageChannelId,
  alreadyBoarded,
}) {
  if (!config.enabled) return { board: false, reason: 'disabled' };
  if (!config.channelId) return { board: false, reason: 'no-channel' };
  if (config.emoji !== emojiName && config.emoji !== emojiId) {
    return { board: false, reason: 'wrong-emoji' };
  }
  if (messageChannelId === config.channelId) return { board: false, reason: 'board-channel' };
  if (alreadyBoarded) return { board: false, reason: 'already-boarded' };
  if ((count ?? 0) < config.threshold) return { board: false, reason: 'below-threshold' };
  return { board: true };
}

/**
 * Parse an admin's emoji input: a custom-emoji mention (`<:name:id>` or
 * animated `<a:name:id>`) stores the ID; anything else short and non-empty is
 * treated as a unicode emoji and stored verbatim.
 * @returns {{ ok:true, value:string, display:string } | { ok:false }}
 */
export function parseEmojiInput(raw) {
  const text = String(raw ?? '').trim();
  const custom = /^<a?:\w+:(\d{15,21})>$/.exec(text);
  if (custom) return { ok: true, value: custom[1], display: text };
  // ≤16 UTF-16 units allows ZWJ sequences (👮‍♂️, flags); reject plain words.
  if (text.length === 0 || text.length > 16 || /^[\w\s]+$/.test(text)) return { ok: false };
  return { ok: true, value: text, display: text };
}

/** How a stored emoji value renders in messages (custom ids need the mention form). */
export function displayEmoji(value) {
  return /^\d{15,21}$/.test(String(value)) ? `<:e:${value}>` : String(value);
}

const MAX_CONTENT = 1_000;

/**
 * Harvest readable text from a message's embeds — the only text an embed-only
 * message (bot posts, link previews) has. Accepts plain embed-shaped objects
 * ({title, description, fields[]}, or the same under .data).
 * @returns {string} '' when the embeds carry no text
 */
export function textFromEmbeds(embeds) {
  const parts = [];
  for (const raw of embeds ?? []) {
    const e = raw?.data ?? raw ?? {};
    if (e.title) parts.push(String(e.title));
    if (e.description) parts.push(String(e.description));
    for (const field of e.fields ?? []) {
      if (field?.name) parts.push(String(field.name));
      if (field?.value) parts.push(String(field.value));
    }
  }
  return parts.join('\n').trim();
}

/**
 * The render model for a board post, from a plain message snapshot.
 * @param {{ content?:string, authorName:string, avatarUrl?:string|null,
 *           attachments?:Array<{url:string, contentType?:string|null}>,
 *           url:string, channelId:string, stars:number }} snap
 */
export function boardModel(snap) {
  let content = String(snap.content ?? '').trim();
  if (content.length > MAX_CONTENT) content = `${content.slice(0, MAX_CONTENT - 1)}…`;
  if (content.length === 0) content = '_(no text — see the original message)_';
  const image = (snap.attachments ?? []).find((a) => /^image\//.test(a.contentType ?? '')) ?? null;
  return {
    authorName: snap.authorName,
    avatarUrl: snap.avatarUrl ?? null,
    content,
    imageUrl: image?.url ?? null,
    jumpUrl: snap.url,
    channelId: snap.channelId,
    stars: snap.stars,
  };
}

/**
 * Record a boarded message in the store value, bounding its size (oldest out).
 * @param {{ order?:string[], posts?:Record<string,string> }} data
 * @returns the updated value
 */
export function recordBoarded(data, messageId, boardMessageId, keep = 1_000) {
  const order = [...(data.order ?? []), messageId].slice(-keep);
  const posts = { ...(data.posts ?? {}), [messageId]: boardMessageId };
  for (const id of Object.keys(posts)) {
    if (!order.includes(id)) delete posts[id];
  }
  return { order, posts };
}

export function isBoarded(data, messageId) {
  return Boolean(data?.posts?.[messageId]);
}
