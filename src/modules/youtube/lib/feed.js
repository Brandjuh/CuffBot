// Pure YouTube-feed logic — no discord.js, no network. YouTube publishes a
// free Atom feed per channel (https://www.youtube.com/feeds/videos.xml?channel_id=UC…),
// so upload detection needs no API key — same zero-dependency approach as the
// memorial module's RSS parser (S21), but for Atom's <entry> shape.

export const FEED_URL_PREFIX = 'https://www.youtube.com/feeds/videos.xml?channel_id=';
export const SEEN_CAP = 50; // remembered video ids per creator (ring)
export const POST_CAP_PER_SWEEP = 3; // max announcements per creator per sweep
export const MAX_CREATORS = 25; // status embed stays readable

const decodeEntities = (text) =>
  String(text ?? '')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const strip = (text) =>
  decodeEntities(String(text ?? '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();

/**
 * Parse a YouTube channel Atom feed. Garbage in → `{channelTitle: null, videos: []}`.
 * @returns {{channelTitle: string|null, videos: Array<{videoId, title, url, publishedAt}>}}
 */
export function parseYouTubeFeed(xml) {
  const text = String(xml ?? '');
  const entryBlocks = text.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  const head = text.slice(0, text.indexOf('<entry>') === -1 ? text.length : text.indexOf('<entry>'));
  const channelTitle = strip(head.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '') || null;

  const videos = [];
  for (const block of entryBlocks) {
    const videoId =
      block.match(/<yt:videoId>([\w-]{6,20})<\/yt:videoId>/)?.[1] ??
      block.match(/<id>yt:video:([\w-]{6,20})<\/id>/)?.[1] ??
      null;
    if (!videoId) continue;
    const title = strip(block.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? '') || '(untitled)';
    const url =
      block.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/)?.[1] ??
      `https://www.youtube.com/watch?v=${videoId}`;
    const publishedAt = Date.parse(block.match(/<published>([^<]+)<\/published>/)?.[1] ?? '') || 0;
    videos.push({ videoId, title, url: decodeEntities(url), publishedAt });
  }
  return { channelTitle, videos };
}

/**
 * Extract a YouTube channel id (UC…) from the inputs admins actually paste:
 * a raw id, a /channel/UC… URL, or a feed URL. Handles (@name) cannot be
 * resolved offline — those return `{handle}` so the service can look them up.
 * @returns {{channelId: string}|{handle: string}|null}
 */
export function parseCreatorInput(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  const direct = text.match(/^(UC[0-9A-Za-z_-]{16,32})$/);
  if (direct) return { channelId: direct[1] };
  const inUrl = text.match(/(?:channel\/|channel_id=)(UC[0-9A-Za-z_-]{16,32})/);
  if (inUrl) return { channelId: inUrl[1] };
  const handle = text.match(/^@([\w.-]{2,50})$/) ?? text.match(/youtube\.com\/@([\w.-]{2,50})/);
  if (handle) return { handle: handle[1] };
  return null;
}

/**
 * The videos to announce: not seen yet, oldest first, capped per sweep so a
 * feed hiccup can never flood the channel.
 */
export function pickNewVideos(videos, seenIds, { cap = POST_CAP_PER_SWEEP } = {}) {
  const seen = new Set(seenIds ?? []);
  return videos
    .filter((v) => !seen.has(v.videoId))
    .sort((a, b) => a.publishedAt - b.publishedAt)
    .slice(0, cap);
}

/** Ring-buffer the seen list so it never grows unbounded. */
export function rememberSeen(seenIds, videoIds, { cap = SEEN_CAP } = {}) {
  const merged = [...(seenIds ?? [])];
  for (const id of videoIds) if (!merged.includes(id)) merged.push(id);
  return merged.slice(-cap);
}

/**
 * One announcement line — Discord auto-embeds the URL as a playable card.
 * With a pingRoleId the role mention leads the message (S53 owner request);
 * the caller scopes allowedMentions to exactly that role.
 */
export function formatAnnouncement(creatorName, video, { pingRoleId = null } = {}) {
  const ping = pingRoleId ? `<@&${pingRoleId}> ` : '';
  return `${ping}📺 **${creatorName}** just uploaded: **${video.title}**\n${video.url}`;
}
