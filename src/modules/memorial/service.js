// Memorial service — polls the fallen-heroes feeds and honors new entries in
// the configured channel, tagging the matching role (owner-specified feed →
// role mapping). Parsing is pure (lib/rss.js); this file owns fetch, the seen
// store, and posting.
import { EmbedBuilder } from 'discord.js';
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { mergeSeen, parseFeed, unseenItems } from './lib/rss.js';

export const MEMORIAL_CONFIG_KEY = 'memorialConfig';
export const MEMORIAL_SEEN_KEY = 'memorialSeen';
export const DEFAULT_MEMORIAL_CONFIG = { enabled: true, channelId: null };

// Owner-specified sources (S16 backlog): feed → role to tag. Committed here as
// product config, like homeGuildId — these ids are the owner's own guild roles.
export const FEEDS = [
  {
    id: 'firehero',
    title: 'Fallen Firefighters',
    emoji: '🚒',
    url: 'https://www.firehero.org/feed/',
    roleId: '627943529544417300',
  },
  {
    id: 'odmp',
    title: 'Fallen Officers',
    emoji: '🚓',
    url: 'https://www.odmp.org/feed',
    roleId: '451095508560379934',
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

/** Fetch + parse one feed. Returns [] on any failure (logged, never thrown). */
export async function fetchFeedItems(feed, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(feed.url, {
      headers: { 'User-Agent': 'CuffBot memorial (Discord bot; respectful RSS polling)' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      logger.warn(`Memorial: ${feed.id} feed returned HTTP ${res.status}`);
      return [];
    }
    return parseFeed(await res.text());
  } catch (error) {
    logger.warn(`Memorial: ${feed.id} feed unreachable (${error.message})`);
    return [];
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
  if (!config.enabled || !config.channelId) return 0;
  const channel = guild.channels.cache.get(config.channelId);
  if (!channel?.send) return 0;

  let posted = 0;
  for (const feed of FEEDS) {
    const items = await fetchFeedItems(feed, fetchImpl);
    if (items.length === 0) continue;

    const seenIds = getSeen(guild.id)[feed.id];
    if (!Array.isArray(seenIds)) {
      // Baseline: never seen this feed before — record, don't post.
      updateGuildData(
        guild.id,
        MEMORIAL_SEEN_KEY,
        (seen) => ({ ...seen, [feed.id]: mergeSeen([], items.map((i) => i.id)) }),
        {},
      );
      logger.info(`Memorial: baselined ${feed.id} with ${items.length} existing item(s).`);
      continue;
    }

    const fresh = unseenItems(items, seenIds);
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
