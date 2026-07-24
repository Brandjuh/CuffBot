// Pure starboard rules — no discord.js. Decides WHETHER a reaction event
// boards a message and WHAT the board post looks like, from plain values.

export const DEFAULT_STARBOARD_CONFIG = {
  enabled: true,
  channelId: null,
  threshold: 3, // stars needed
  emoji: '⭐',
};

/**
 * Should this reaction state put the message on the board?
 * @returns {{ board:true } | { board:false, reason:string }}
 */
export function shouldBoard({
  emojiName,
  count,
  config,
  messageChannelId,
  alreadyBoarded,
}) {
  if (!config.enabled) return { board: false, reason: 'disabled' };
  if (!config.channelId) return { board: false, reason: 'no-channel' };
  if (emojiName !== config.emoji) return { board: false, reason: 'wrong-emoji' };
  if (messageChannelId === config.channelId) return { board: false, reason: 'board-channel' };
  if (alreadyBoarded) return { board: false, reason: 'already-boarded' };
  if ((count ?? 0) < config.threshold) return { board: false, reason: 'below-threshold' };
  return { board: true };
}

const MAX_CONTENT = 1_000;

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
