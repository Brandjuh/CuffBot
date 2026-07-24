// Memorial service — polls the fallen-heroes feeds and honors new entries in
// the configured channel, tagging the matching role (owner-specified feed →
// role mapping). Parsing is pure (lib/rss.js); this file owns fetch, the seen
// store, and posting.
import { EmbedBuilder } from 'discord.js';
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { itemMatchesFeed, mergeSeen, parseFeed, unseenItems } from './lib/rss.js';
import { resolveSendableChannel } from '../../core/channels.js';

export const MEMORIAL_CONFIG_KEY = 'memorialConfig';
export const MEMORIAL_SEEN_KEY = 'memorialSeen';
// S60 (owner request): each feed can have its OWN channel — `<feedId>ChannelId`
// wins over the shared `channelId` fallback. No ids invented: the owner sets
// them via /memorial-config officers-channel: / firefighters-channel:.
export const DEFAULT_MEMORIAL_CONFIG = {
  enabled: true,
  channelId: null,
  odmpChannelId: '451095508560379934', // S61 owner decision: officers channel
  fireheroChannelId: null,
};

/** The channel a feed posts to: its own override, else the shared channel. */
export function channelIdForFeed(config, feedId) {
  return config[`${feedId}ChannelId`] ?? config.channelId ?? null;
}

// Owner-specified sources (S16 backlog): feed → role to tag. Committed here as
// product config, like homeGuildId — these ids are the owner's own guild roles.
export const FEEDS = [
  {
    id: 'firehero',
    title: 'Fallen Firefighters',
    emoji: '🚒',
    url: 'https://www.firehero.org/feed/',
    roleId: '627943529544417300',
    // S61 owner finding: firehero.org has NO memorial-only feed — its feeds
    // carry all site news. Only hero-profile items pass (their pages live
    // under /fallen-firefighter/); plain news is filtered out, never posted.
    match: { linkIncludes: ['/fallen-firefighter'] },
  },
  {
    id: 'odmp',
    title: 'Fallen Officers',
    emoji: '🚓',
    url: 'https://www.odmp.org/feed',
    // S61 owner correction: the previously committed role id
    // (451095508560379934) is actually the owner's officers CHANNEL — it now
    // lives in DEFAULT_MEMORIAL_CONFIG.odmpChannelId; this is the real role.
    roleId: '627946543273738240',
  },
];

export function getMemorialConfig(guildId) {
  return { ...DEFAULT_MEMORIAL_CONFIG, ...getGuildData(guildId, MEMORIAL_CONFIG_KEY, {}) };
}

export function setMemorialConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, MEMORIAL_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, MEMORIAL_CONFIG_KEY, stored);
  return { ...DEFAULT_MEMORIAL_CONFIG, ...stored };
}

export function getSeen(guildId) {
  return getGuildData(guildId, MEMORIAL_SEEN_KEY, {});
}

/**
 * Fetch + parse one feed. Returns the item list on success (possibly empty),
 * or **null on any failure** (logged, never thrown) — S61: callers must be
 * able to tell "reachable but nothing matches" from "unreachable".
 */
export async function fetchFeedItems(feed, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(feed.url, {
      headers: { 'User-Agent': 'CuffBot memorial (Discord bot; respectful RSS polling)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.warn(`Memorial: ${feed.id} feed returned HTTP ${res.status}`);
      return null;
    }
    return parseFeed(await res.text());
  } catch (error) {
    logger.warn(`Memorial: ${feed.id} feed unreachable (${error.message})`);
    return null;
  }
}

/**
 * Live-check ANY candidate feed URL (S61): the owner is hunting for a real
 * fallen-firefighters source, and the Pi is the only place with open
 * internet — `/memorial-config probe:<url>` runs this there and shows what
 * the feed actually contains before anything is committed.
 */
export async function probeFeed(url, { fetchImpl = fetch } = {}) {
  if (!/^https?:\/\//i.test(String(url ?? ''))) return { ok: false, code: 'bad-url' };
  try {
    const res = await fetchImpl(url, {
      headers: { 'User-Agent': 'CuffBot memorial (Discord bot; respectful RSS polling)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return { ok: false, code: 'http', status: res.status };
    const items = parseFeed(await res.text());
    return {
      ok: true,
      total: items.length,
      sample: items.slice(0, 3).map(({ title, link }) => ({ title, link })),
    };
  } catch (error) {
    return { ok: false, code: 'unreachable', message: error?.message ?? String(error) };
  }
}

export function memorialEmbed(feed, item) {
  const embed = new EmbedBuilder()
    .setColor(0x2c3e50)
    .setTitle(`🕯️ ${feed.emoji} ${item.title}`)
    .setDescription(
      `${feed.title} — gone, but not forgotten.${item.pubDate ? `\n_${item.pubDate}_` : ''}`,
    );
  if (item.link && /^https?:\/\//i.test(item.link)) embed.setURL(item.link);
  return embed;
}

/**
 * One polling sweep for a guild. First sight of a feed BASELINES it: all
 * current items are marked seen without posting (a fresh install must honor
 * the fallen going forward, not spam years of history). After the baseline,
 * new items post oldest-first (max 5 per feed per sweep), tagging the feed's
 * role — the one intentional ping in this bot.
 * @returns {Promise<number>} posts made
 */
export async function sweepMemorial(guild, { fetchImpl = fetch } = {}) {
  const config = getMemorialConfig(guild.id);
  if (!config.enabled) return 0;

  let posted = 0;
  for (const feed of FEEDS) {
    // S60: each feed posts to its own channel (shared channelId as fallback);
    // a feed without a usable channel skips this tick — the others still run.
    const channelId = channelIdForFeed(config, feed.id);
    if (!channelId) continue;
    const channel = await resolveSendableChannel(guild, channelId);
    if (!channel) continue;

    const items = await fetchFeedItems(feed, fetchImpl);
    if (items === null) continue; // unreachable — retry next sweep, no baseline
    // S61: only items matching the feed's rules are honored (general-news
    // feeds post nothing but memorial entries).
    const matching = items.filter((item) => itemMatchesFeed(feed.match, item));

    const seenIds = getSeen(guild.id)[feed.id];
    if (!Array.isArray(seenIds)) {
      // Baseline on the first successful fetch — even with zero matching
      // items (a filtered feed may be all-news today): record, don't post.
      updateGuildData(
        guild.id,
        MEMORIAL_SEEN_KEY,
        (seen) => ({ ...seen, [feed.id]: mergeSeen([], matching.map((i) => i.id)) }),
        {},
      );
      logger.info(`Memorial: baselined ${feed.id} with ${matching.length} matching item(s) (${items.length} total).`);
      continue;
    }

    const fresh = unseenItems(matching, seenIds);
    for (const item of fresh) {
      try {
        await channel.send({
          content: `<@&${feed.roleId}>`,
          embeds: [memorialEmbed(feed, item)],
          allowedMentions: { roles: [feed.roleId] },
        });
        posted += 1;
        // Mark seen per successful post — a failure retries next sweep.
        updateGuildData(
          guild.id,
          MEMORIAL_SEEN_KEY,
          (seen) => ({ ...seen, [feed.id]: mergeSeen(seen[feed.id], [item.id]) }),
          {},
        );
      } catch (error) {
        logger.warn(`Memorial: post failed for ${feed.id} (${error.message})`);
        break; // channel is broken right now; retry the rest next sweep
      }
    }
  }
  return posted;
}
