// Hunting service (S66 = M16.1): the vrt-cogs spawn scheduler, the active
// hunt per channel, shout/reaction resolution, scores, and the escape that
// still pickpockets into the donut pot (owner's own S38/S41 wiring). Pure
// rules live in lib/hunt.js; economy money moves through its seams.
import { getGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import {
  CROOKS,
  DEFAULT_HUNTING_CONFIG,
  addCatch,
  formatResponseTime,
  nextSpawnDelayMs,
  pickCrook,
  resolveShout,
  rollReward,
} from './lib/hunt.js';
import { addToPot, adjustBalance } from '../economy/service.js';
import { pickVictim, randomInt } from '../economy/lib/bank.js';

export const HUNTING_CONFIG_KEY = 'huntingConfig';
export const HUNTING_SCORES_KEY = 'huntingScores';

export function getHuntingConfig(guildId) {
  return { ...DEFAULT_HUNTING_CONFIG, ...getGuildData(guildId, HUNTING_CONFIG_KEY, {}) };
}

export function setHuntingConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, HUNTING_CONFIG_KEY, {}), ...patch };
  updateGuildData(guildId, HUNTING_CONFIG_KEY, () => stored, {});
  return { ...DEFAULT_HUNTING_CONFIG, ...stored };
}

/** { [userId]: { total, byCrook: { [crookId]: n } } } */
export function getScores(guildId) {
  return getGuildData(guildId, HUNTING_SCORES_KEY, {});
}

export function recordCatch(guildId, userId, crookId) {
  updateGuildData(
    guildId,
    HUNTING_SCORES_KEY,
    (all) => ({ ...all, [userId]: addCatch(all[userId], crookId) }),
    {},
  );
}

export function topHunters(guildId, limit = 25) {
  return Object.entries(getScores(guildId))
    .map(([userId, r]) => ({ userId, total: r.total ?? 0 }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, limit);
}

// ── RAM state (a restart forgets scheduling; the next message re-arms it) ────

const nextSpawnAt = new Map(); // guildId → timestamp
const activeHunts = new Map(); // channelId → {crook, guildId, expiresAt, spawnedAt, timer, resolved}
const pendingSpawns = new Map(); // channelId → timeout

export function activeHunt(channelId) {
  return activeHunts.get(channelId) ?? null;
}

/** Test hook: clear all RAM hunting state. */
export function resetHuntingState() {
  for (const hunt of activeHunts.values()) clearTimeout(hunt.timer);
  for (const timer of pendingSpawns.values()) clearTimeout(timer);
  activeHunts.clear();
  pendingSpawns.clear();
  nextSpawnAt.clear();
}

/** Can the game run in this mode? Words mode needs Message Content. */
export function huntingAvailable(client, config) {
  return config.mode === 'reaction' || Boolean(client?.messageContentAvailable);
}

/**
 * The vrt scheduler, ported exactly: a message in an enabled channel first
 * ARMS the guild clock (now + random interval); once a later message finds
 * the clock elapsed, the channel is locked, the clock re-arms, and the crook
 * appears after ANOTHER random interval. @returns what happened (for tests).
 */
export function noteMessage(message, { random = Math.random, now = Date.now() } = {}) {
  const guild = message.guild;
  const config = getHuntingConfig(guild.id);
  if (!config.enabled || !config.channels.includes(message.channel.id)) return 'off';
  if (!huntingAvailable(message.client, config)) return 'unavailable';
  if (activeHunts.has(message.channel.id) || pendingSpawns.has(message.channel.id)) return 'busy';

  const delay = nextSpawnDelayMs(config, random);
  if (!nextSpawnAt.has(guild.id)) {
    nextSpawnAt.set(guild.id, now + delay);
    return 'armed';
  }
  if (now < nextSpawnAt.get(guild.id)) return 'waiting';

  nextSpawnAt.set(guild.id, now + delay);
  const timer = setTimeout(() => {
    pendingSpawns.delete(message.channel.id);
    spawnCrook(message.channel, { random }).catch((error) =>
      logger.warn('Hunting: spawn failed:', error),
    );
  }, delay);
  timer.unref?.();
  pendingSpawns.set(message.channel.id, timer);
  return 'scheduled';
}

/** When the next crook can appear (for /hunting next). */
export function nextSpawnInfo(guildId, now = Date.now()) {
  const at = nextSpawnAt.get(guildId);
  return at ? Math.max(0, at - now) : null;
}

/** Post the crook and arm the escape timer. Exported for tests and test-spawns. */
export async function spawnCrook(channel, { random = Math.random, now = Date.now(), crook = null } = {}) {
  const config = getHuntingConfig(channel.guild.id);
  const picked = crook ?? pickCrook(random, { undercover: config.undercover });
  let posted;
  try {
    posted = await channel.send({ content: picked.line, allowedMentions: { parse: [] } });
  } catch (error) {
    logger.warn('Hunting: could not post the crook:', error?.message ?? error);
    return null;
  }
  if (config.mode === 'reaction') {
    try {
      await posted.react?.('🚨');
      if (picked.undercover) await posted.react?.('🫡');
    } catch {
      /* reactions are best-effort */
    }
  }
  const hunt = {
    crook: picked,
    guildId: channel.guild.id,
    channelId: channel.id,
    spawnedAt: now,
    expiresAt: now + config.catchTimeoutS * 1000,
    resolved: false,
    timer: setTimeout(() => {
      activeHunts.delete(channel.id);
      escapeCrook(channel, picked, { random }).catch((error) =>
        logger.warn('Hunting: escape handling failed:', error),
      );
    }, config.catchTimeoutS * 1000),
  };
  hunt.timer.unref?.();
  activeHunts.set(channel.id, hunt);
  return hunt;
}

/**
 * The crook escaped (nobody shouted in time): vrt just says "flew away", but
 * the precinct keeps the owner's rule — the crook pickpockets a random member
 * into the donut pot. Economy seams wrapped: a broken economy never breaks
 * the hunt message.
 */
export async function escapeCrook(channel, crook, { random = Math.random } = {}) {
  const guild = channel.guild;
  const config = getHuntingConfig(guild.id);
  if (crook.undercover) {
    await channel
      .send({ content: `🕵️ The undercover officer slipped back into the crowd. Nobody saluted.`, allowedMentions: { parse: [] } })
      .catch(() => {});
    return null;
  }
  let line = `💨 **The ${crook.id.replace(/-/g, ' ')} got away!**`;
  try {
    const candidates = [...(guild.members?.cache?.values() ?? [])]
      .filter((m) => !m.user?.bot)
      .map((m) => m.id);
    const victimId = pickVictim(candidates, random);
    if (victimId) {
      const wanted = randomInt(config.escapeStealMin, config.escapeStealMax, random);
      const { applied } = adjustBalance(guild.id, victimId, -wanted);
      const stolen = Math.abs(applied);
      if (stolen > 0) {
        const potBalance = addToPot(guild.id, stolen);
        const victimName = guild.members?.cache?.get(victimId)?.displayName ?? `<@${victimId}>`;
        line = `💨 **The ${crook.id.replace(/-/g, ' ')} got away…** and pickpocketed **${stolen.toLocaleString('en-US')} 🍩** from **${victimName}** into the donut pot (now **${potBalance.toLocaleString('en-US')} 🍩** — \`/crack-pot\`).`;
      }
    }
  } catch (error) {
    logger.warn('Hunting: escape steal failed:', error?.message ?? error);
  }
  await channel.send({ content: line, allowedMentions: { parse: [] } }).catch(() => {});
  return null;
}

/**
 * Someone shouted (or reacted) at the active crook. `kind`: 'catch' | 'salute'.
 * Applies the 2/17 fumble, pays or fines (fines feed the pot — recorded
 * deviation from the cog's plain withdraw), records the score, announces.
 * @returns {'fumbled'|'caught'|'cuffed-colleague'|'saluted'|'ignored'|null}
 */
export async function resolveHunt(channel, member, kind, { random = Math.random, now = Date.now() } = {}) {
  const hunt = activeHunts.get(channel.id);
  if (!hunt || hunt.resolved || now >= hunt.expiresAt) return null;
  const config = getHuntingConfig(hunt.guildId);
  const outcome = resolveShout(hunt.crook, kind, random);
  if (outcome === 'ignored') return 'ignored';

  hunt.resolved = true;
  clearTimeout(hunt.timer);
  activeHunts.delete(channel.id);

  const who = member.displayName ?? member.user?.username ?? 'An officer';
  const timeNote = config.showTime ? formatResponseTime(now - hunt.spawnedAt) : '';
  const crookName = hunt.crook.id.replace(/-/g, ' ');
  let line;
  if (outcome === 'fumbled') {
    line = `😬 **${who}** fumbled the cuffs${timeNote} — the ${crookName} got away!`;
  } else if (outcome === 'caught') {
    const reward = rollReward(config, random);
    let balance = null;
    try {
      balance = adjustBalance(hunt.guildId, member.id, reward).balance;
    } catch (error) {
      logger.warn('Hunting: reward payout failed:', error?.message ?? error);
    }
    recordCatch(hunt.guildId, member.id, hunt.crook.id);
    line = `🚔 **GOTCHA!** ${who} cuffed the ${crookName}${timeNote} and earned **${reward.toLocaleString('en-US')} 🍩**${balance !== null ? ` (balance: ${balance.toLocaleString('en-US')})` : ''}.`;
  } else if (outcome === 'saluted') {
    const reward = rollReward(config, random);
    try {
      adjustBalance(hunt.guildId, member.id, reward);
    } catch (error) {
      logger.warn('Hunting: salute payout failed:', error?.message ?? error);
    }
    recordCatch(hunt.guildId, member.id, hunt.crook.id);
    line = `🫡 **${who}** saluted the undercover officer${timeNote} and earned **${reward.toLocaleString('en-US')} 🍩**. Respect.`;
  } else {
    // cuffed-colleague: the fine lands in the pot (owner's lost-donuts rule).
    const fine = rollReward(config, random);
    let paid = 0;
    try {
      paid = Math.abs(adjustBalance(hunt.guildId, member.id, -fine).applied);
      if (paid > 0) addToPot(hunt.guildId, paid);
    } catch (error) {
      logger.warn('Hunting: fine failed:', error?.message ?? error);
    }
    line = `🚨 **Oh no!** ${who} cuffed an UNDERCOVER OFFICER${timeNote} — internal affairs fines **${paid.toLocaleString('en-US')} 🍩** into the donut pot. Next time: salute 🫡.`;
  }
  await channel.send({ content: line, allowedMentions: { parse: [] } }).catch(() => {});
  return outcome;
}
