// Rules service (S97 = M18, owner request). Storage plus the published post,
// which the bot **edits in place** on every change — the point of the feature
// is that the precinct's rules live at one stable link, not scattered across a
// channel in whatever order they were written.
//
// The publish mechanics follow the selfroles pattern (S59/S64), which solved
// the same problem: track the message ids, edit each in place, post what is
// missing, delete what became surplus, and clean up after a channel move.
import { EmbedBuilder } from 'discord.js';
import { getGuildData, setGuildData } from '../../core/store.js';
import { resolveSendableChannel } from '../../core/channels.js';
import { normalizeRules, paginateRules } from './lib/rules.js';

export const RULES_KEY = 'rules';
export const RULES_CONFIG_KEY = 'rulesConfig';
export const RULES_MESSAGE_KEY = 'rulesMessage';

export const DEFAULT_RULES_CONFIG = {
  channelId: null, // set with `!rules channel #precinct-rules`
  title: '📜 Precinct Rules',
  header: '',
  footer: '',
  color: 0x2b6cb0,
};

export function getRulesConfig(guildId) {
  return { ...DEFAULT_RULES_CONFIG, ...getGuildData(guildId, RULES_CONFIG_KEY, {}) };
}

export function setRulesConfig(guildId, patch) {
  // Sparse storage (S35): only what an admin explicitly set is written, so
  // improving a default later reaches a guild that never overrode it.
  const stored = { ...getGuildData(guildId, RULES_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, RULES_CONFIG_KEY, stored);
  return { ...DEFAULT_RULES_CONFIG, ...stored };
}

export function getRules(guildId) {
  return normalizeRules(getGuildData(guildId, RULES_KEY, []));
}

export function setRules(guildId, rules) {
  setGuildData(guildId, RULES_KEY, normalizeRules(rules));
}

/** The embed payloads the published post consists of — one per page. */
export function buildRulesPayloads(guildId) {
  const config = getRulesConfig(guildId);
  const rules = getRules(guildId);
  const pages = paginateRules(rules, { header: config.header, footer: config.footer });
  return pages.map((page, index) => {
    const embed = new EmbedBuilder().setColor(config.color).setDescription(page.description);
    // Only the first page carries the title, so a multi-page rulebook reads as
    // one document rather than as N documents with the same name.
    if (page.first) embed.setTitle(config.title);
    if (pages.length > 1) embed.setFooter({ text: `Page ${index + 1} of ${pages.length}` });
    return { embeds: [embed], allowedMentions: { parse: [] } };
  });
}

// One publish at a time per guild: two commands landing together must not
// race into duplicate posts (the selfroles lock, same reasoning).
const locks = new Map();
function withLock(guildId, task) {
  const previous = locks.get(guildId) ?? Promise.resolve();
  const next = previous.then(task, task);
  locks.set(guildId, next.catch(() => {}));
  return next;
}

const trackedIds = (tracked) => (Array.isArray(tracked?.messageIds) ? tracked.messageIds : []);

/**
 * Bring the published post in line with the stored rules.
 *
 * @returns {Promise<'unconfigured'|'missing-channel'|'edited'|'posted'>}
 *   'edited' means every page already existed and was updated in place —
 *   which is the normal case and the whole point of the feature.
 */
export async function publishRules(guild) {
  return withLock(guild.id, async () => {
    const config = getRulesConfig(guild.id);
    if (!config.channelId) return 'unconfigured';
    const channel = await resolveSendableChannel(guild, config.channelId);
    if (!channel) return 'missing-channel';

    const payloads = buildRulesPayloads(guild.id);
    const tracked = getGuildData(guild.id, RULES_MESSAGE_KEY, null);
    const oldIds = trackedIds(tracked);
    const sameChannel = tracked?.channelId === channel.id;

    const newIds = [];
    let postedAny = false;
    for (let i = 0; i < payloads.length; i += 1) {
      const existingId = sameChannel ? oldIds[i] : undefined;
      if (existingId) {
        try {
          const message = await channel.messages.fetch(existingId);
          await message.edit(payloads[i]);
          newIds.push(existingId);
          continue;
        } catch {
          /* deleted or unreachable — post a fresh one below */
        }
      }
      const sent = await channel.send(payloads[i]);
      newIds.push(sent.id);
      postedAny = true;
    }

    // The rulebook shrank: drop the now-surplus pages.
    if (sameChannel) {
      for (const id of oldIds.slice(payloads.length)) {
        await channel.messages.delete(id).catch(() => {});
      }
    } else if (tracked?.channelId && oldIds.length) {
      // The rules moved channels: best-effort cleanup of the old copies, so
      // the precinct is never left with two rulebooks.
      const oldChannel = await resolveSendableChannel(guild, tracked.channelId);
      for (const id of oldIds) {
        await oldChannel?.messages?.delete(id).catch(() => {});
      }
    }

    setGuildData(guild.id, RULES_MESSAGE_KEY, { channelId: channel.id, messageIds: newIds });
    return postedAny ? 'posted' : 'edited';
  });
}

/** Where the published rulebook lives right now, if anywhere. */
export function publishedAt(guildId) {
  const tracked = getGuildData(guildId, RULES_MESSAGE_KEY, null);
  const ids = trackedIds(tracked);
  if (!tracked?.channelId || ids.length === 0) return null;
  return { channelId: tracked.channelId, messageIds: ids };
}
