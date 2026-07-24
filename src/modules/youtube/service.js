// YouTube announcer service: creator roster + seen-tracking in the store,
// feed fetching, and the sweep that posts new uploads. Pure feed logic lives
// in lib/feed.js. No API key — YouTube's public Atom feeds only.
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import {
  FEED_URL_PREFIX,
  MAX_CREATORS,
  formatAnnouncement,
  parseCreatorInput,
  parseYouTubeFeed,
  pickNewVideos,
  rememberSeen,
} from './lib/feed.js';

export const YOUTUBE_CONFIG_KEY = 'youtubeConfig';
export const YOUTUBE_CREATORS_KEY = 'youtubeCreators';

// No announce channel invented: the owner asked for "a specific channel"
// without naming one — /youtube channel:#… sets it (nothing posts until then).
// The ping role IS owner-named (S53) and therefore committed; announcements
// ping exactly that role (the memorial pattern: the bot's one deliberate ping).
export const DEFAULT_YOUTUBE_CONFIG = { enabled: true, channelId: null, pingRoleId: '625326875442675763' };

export function getYouTubeConfig(guildId) {
  return { ...DEFAULT_YOUTUBE_CONFIG, ...getGuildData(guildId, YOUTUBE_CONFIG_KEY, {}) };
}

export function setYouTubeConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, YOUTUBE_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, YOUTUBE_CONFIG_KEY, stored);
  return { ...DEFAULT_YOUTUBE_CONFIG, ...stored };
}

/** { [ytChannelId]: { name, seenVideoIds: [] } } */
export function getCreators(guildId) {
  return getGuildData(guildId, YOUTUBE_CREATORS_KEY, {});
}

const FETCH_TIMEOUT_MS = 15_000;

async function fetchText(url, fetchImpl) {
  const impl = fetchImpl ?? globalThis.fetch;
  const response = await impl(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { 'user-agent': 'CuffBot (Discord bot; YouTube upload announcer)' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

/** Resolve any admin input (UC id, URL, @handle) to a channel id, or null. */
export async function resolveChannelId(input, { fetchImpl } = {}) {
  const parsed = parseCreatorInput(input);
  if (!parsed) return null;
  if (parsed.channelId) return parsed.channelId;
  // Handles need one page fetch — the id sits in the page source.
  try {
    const html = await fetchText(`https://www.youtube.com/@${parsed.handle}`, fetchImpl);
    return html.match(/"channelId":"(UC[0-9A-Za-z_-]{16,32})"/)?.[1] ?? null;
  } catch (error) {
    logger.warn(`YouTube: handle resolution for @${parsed.handle} failed:`, error?.message ?? error);
    return null;
  }
}

/**
 * Add a creator: resolve the id, fetch the feed once to validate and learn
 * the channel name, and BASELINE every current video as seen — adding a
 * creator never floods the channel with their back catalog (memorial rule).
 * @returns {{ok: true, name: string, channelId: string, latest: string|null}
 *         | {ok: false, code: 'bad-input'|'fetch-failed'|'full'|'exists'}}
 */
export async function addCreator(guildId, input, { fetchImpl } = {}) {
  const channelId = await resolveChannelId(input, { fetchImpl });
  if (!channelId) return { ok: false, code: 'bad-input' };
  const creators = getCreators(guildId);
  if (creators[channelId]) return { ok: false, code: 'exists', name: creators[channelId].name };
  if (Object.keys(creators).length >= MAX_CREATORS) return { ok: false, code: 'full' };

  let feed;
  try {
    feed = parseYouTubeFeed(await fetchText(`${FEED_URL_PREFIX}${channelId}`, fetchImpl));
  } catch (error) {
    logger.warn(`YouTube: feed fetch for ${channelId} failed:`, error?.message ?? error);
    return { ok: false, code: 'fetch-failed' };
  }
  const name = feed.channelTitle ?? channelId;
  updateGuildData(
    guildId,
    YOUTUBE_CREATORS_KEY,
    (all) => ({
      ...all,
      [channelId]: { name, seenVideoIds: rememberSeen([], feed.videos.map((v) => v.videoId)) },
    }),
    {},
  );
  return { ok: true, name, channelId, latest: feed.videos[0]?.title ?? null };
}

/** Remove by channel id or (case-insensitive) name. Returns the removed name or null. */
export function removeCreator(guildId, input) {
  const needle = String(input ?? '').trim().toLowerCase();
  let removed = null;
  updateGuildData(
    guildId,
    YOUTUBE_CREATORS_KEY,
    (all) => {
      const key = Object.keys(all).find(
        (id) => id.toLowerCase() === needle || all[id].name?.toLowerCase() === needle,
      );
      if (!key) return all;
      removed = all[key].name ?? key;
      const next = { ...all };
      delete next[key];
      return next;
    },
    {},
  );
  return removed;
}

/**
 * One sweep: fetch every creator's feed and announce videos we have not seen.
 * A creator's failed FETCH skips them this tick (retried next sweep); a failed
 * SEND leaves the video unseen so it is retried too. Announcements ping only
 * the configured role (S53) — allowedMentions is scoped to exactly that id.
 * @returns {{posted: number, checked: number}}
 */
export async function sweepYouTube(guild, { fetchImpl, log = true } = {}) {
  const config = getYouTubeConfig(guild.id);
  const creators = getCreators(guild.id);
  const ids = Object.keys(creators);
  if (!config.enabled || !config.channelId || ids.length === 0) return { posted: 0, checked: 0 };
  const channel = guild.channels.cache.get(config.channelId);
  if (!channel?.send) return { posted: 0, checked: 0 };

  let posted = 0;
  let checked = 0;
  for (const id of ids) {
    let feed;
    try {
      feed = parseYouTubeFeed(await fetchText(`${FEED_URL_PREFIX}${id}`, fetchImpl));
      checked += 1;
    } catch (error) {
      if (log) logger.warn(`YouTube: sweep fetch for ${id} failed:`, error?.message ?? error);
      continue;
    }
    const fresh = pickNewVideos(feed.videos, creators[id].seenVideoIds);
    const deliveredIds = [];
    for (const video of fresh) {
      try {
        await channel.send({
          content: formatAnnouncement(creators[id].name ?? feed.channelTitle ?? 'A creator', video, {
            pingRoleId: config.pingRoleId,
          }),
          allowedMentions: config.pingRoleId ? { roles: [config.pingRoleId] } : { parse: [] },
        });
        deliveredIds.push(video.videoId);
        posted += 1;
      } catch (error) {
        if (log) logger.warn(`YouTube: announcement for ${video.videoId} failed:`, error?.message ?? error);
        break; // channel trouble — retry this and the rest next sweep
      }
    }
    if (deliveredIds.length > 0) {
      updateGuildData(
        guild.id,
        YOUTUBE_CREATORS_KEY,
        (all) =>
          all[id]
            ? { ...all, [id]: { ...all[id], seenVideoIds: rememberSeen(all[id].seenVideoIds, deliveredIds) } }
            : all,
        {},
      );
    }
  }
  return { posted, checked };
}

/** Live view for /youtube preview: the latest video per creator, no posting. */
export async function previewYouTube(guildId, { fetchImpl } = {}) {
  const creators = getCreators(guildId);
  const lines = [];
  for (const [id, creator] of Object.entries(creators)) {
    try {
      const feed = parseYouTubeFeed(await fetchText(`${FEED_URL_PREFIX}${id}`, fetchImpl));
      const latest = feed.videos[0];
      lines.push(
        latest
          ? `📺 **${creator.name}** — latest: **${latest.title}**`
          : `📺 **${creator.name}** — no videos in the feed`,
      );
    } catch {
      lines.push(`⚠️ **${creator.name}** — feed unreachable right now`);
    }
  }
  return lines;
}
