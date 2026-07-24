// Resolving a configured post-target channel (S55).
//
// Every module that posts somewhere stores a channel id and used to look it
// up with `guild.channels.cache.get(id)` — a silent no-op whenever the cache
// missed (channel created after boot, cache eviction, boot race). The owner
// experienced exactly that as "the bot has admin rights but cannot post"
// with zero diagnostics. This resolver falls back to the API and returns the
// channel only when it can actually be posted to, so callers keep one truth:
// null = target unusable (and status views can say so out loud).

/**
 * @returns {Promise<import('discord.js').GuildBasedChannel|null>} a channel
 *   with a working `.send`, or null (unknown id, cache+API miss, or a
 *   non-postable type like category/forum).
 */
export async function resolveSendableChannel(guild, channelId) {
  if (!guild || !channelId) return null;
  let channel = guild.channels.cache.get(channelId) ?? null;
  if (!channel && typeof guild.channels?.fetch === 'function') {
    channel = await guild.channels.fetch(channelId).catch(() => null);
  }
  return typeof channel?.send === 'function' ? channel : null;
}
