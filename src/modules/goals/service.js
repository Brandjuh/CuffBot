// Goal storage, the auto-tracked refresh, and milestone announcements
// (S103 = M14). Every decision lives in lib/goals.js; this file holds the
// store access and the one place that talks to Discord.
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import {
  DEFAULT_GOALS_CONFIG,
  applyProgress,
  currentFromSource,
  milestoneMessage,
} from './lib/goals.js';

export const GOALS_CONFIG_KEY = 'goalsConfig';
export const GUILD_GOALS_KEY = 'guildGoals';
export const MEMBER_GOALS_KEY = 'memberGoals';

export function getGoalsConfig(guildId) {
  return { ...DEFAULT_GOALS_CONFIG, ...getGuildData(guildId, GOALS_CONFIG_KEY, {}) };
}

export function setGoalsConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, GOALS_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, GOALS_CONFIG_KEY, stored);
  return { ...DEFAULT_GOALS_CONFIG, ...stored };
}

export const getGuildGoals = (guildId) => getGuildData(guildId, GUILD_GOALS_KEY, {});
export const setGuildGoals = (guildId, goals) => setGuildData(guildId, GUILD_GOALS_KEY, goals);

export const getAllMemberGoals = (guildId) => getGuildData(guildId, MEMBER_GOALS_KEY, {});
export const getMemberGoals = (guildId, userId) => getAllMemberGoals(guildId)[userId] ?? {};

/** Read-modify-write one member's goals, so two commands cannot clobber each other. */
export function updateMemberGoals(guildId, userId, updater) {
  let result;
  updateGuildData(
    guildId,
    MEMBER_GOALS_KEY,
    (all = {}) => {
      result = updater(all[userId] ?? {});
      return { ...all, [userId]: result };
    },
    {},
  );
  return result;
}

/** Same, for the precinct's goals. */
export function updateGuildGoals(guildId, updater) {
  let result;
  updateGuildData(guildId, GUILD_GOALS_KEY, (goals = {}) => {
    result = updater(goals);
    return result;
  }, {});
  return result;
}

export function resetGoals(guildId) {
  setGuildData(guildId, GUILD_GOALS_KEY, {});
  setGuildData(guildId, MEMBER_GOALS_KEY, {});
}

/**
 * Move a precinct goal and announce whatever milestones that crossed.
 *
 * The crossed marks are recorded **as part of the same write** that moves the
 * progress (S22 claim-before-send): a failed announcement means a milestone is
 * missed once, which is far better than a re-sweep announcing 50% every ten
 * minutes forever.
 *
 * @returns {Promise<{ ok: boolean, goal?: object, crossed?: number[], message?: string }>}
 */
export async function moveGoal(guild, goalId, value, { channel = null, now = Date.now() } = {}) {
  const config = getGoalsConfig(guild.id);
  let moved = null;
  let crossed = [];

  updateGuildGoals(guild.id, (goals) => {
    const goal = goals[goalId];
    if (!goal) return goals;
    const step = applyProgress(goal, value, { milestones: config.milestones, now });
    moved = step.goal;
    crossed = step.crossed;
    return { ...goals, [goalId]: step.goal };
  });

  if (!moved) return { ok: false, message: 'That goal is gone.' };
  if (crossed.length > 0) await announce(guild, moved, crossed, channel);
  return { ok: true, goal: moved, crossed };
}

/** Post the milestone lines. Never throws — an announcement is not the feature. */
async function announce(guild, goal, crossed, fallbackChannel) {
  const config = getGoalsConfig(guild.id);
  if (!config.enabled) return;
  let channel = fallbackChannel;
  if (config.announceChannelId) {
    channel = guild.channels.cache.get(config.announceChannelId) ?? (await guild.channels.fetch(config.announceChannelId).catch(() => null)) ?? fallbackChannel;
  }
  if (!channel?.send) return;
  // Only the highest mark is posted: crossing 25% and 50% in one jump is one
  // piece of news, not two.
  const mark = Math.max(...crossed);
  await channel
    .send({ content: milestoneMessage(goal, mark), allowedMentions: { parse: [] } })
    .catch((error) => logger.warn('Goals: could not announce a milestone:', error));
}

/**
 * Bring every auto-tracked goal up to date with what the guild actually says.
 *
 * Called on a sweep and before any read, because the numbers are free: they
 * come off the guild object rather than from a counter this module has to
 * maintain, so there is nothing to drift and nothing to rebuild after a
 * restart.
 *
 * @returns {Promise<number>} how many goals moved
 */
export async function refreshTrackedGoals(guild, { channel = null, now = Date.now() } = {}) {
  const goals = getGuildGoals(guild.id);
  const counts = {
    memberCount: guild.memberCount ?? 0,
    boostCount: guild.premiumSubscriptionCount ?? 0,
  };

  let moved = 0;
  for (const goal of Object.values(goals)) {
    const value = currentFromSource(goal.source, counts);
    if (value === null || value === goal.current) continue;
    // eslint-disable-next-line no-await-in-loop -- announcements must stay ordered
    const result = await moveGoal(guild, goal.id, value, { channel, now });
    if (result.ok) moved += 1;
  }
  return moved;
}

// One sweep for every guild, armed at boot. Fifteen minutes is deliberate: an
// auto-tracked goal is a number that changes slowly, and a tighter loop would
// only mean more writes to the Pi's SD card for the same answer.
const SWEEP_MS = 15 * 60 * 1000;
let sweepTimer = null;

export function startGoalSweep(client, { intervalMs = SWEEP_MS, setTimer, clearTimer } = {}) {
  stopGoalSweep({ clearTimer });
  const arm = setTimer ?? ((fn, ms) => setInterval(fn, ms));
  sweepTimer = arm(() => {
    void sweepAll(client);
  }, intervalMs);
  sweepTimer?.unref?.();
  return sweepTimer;
}

export function stopGoalSweep({ clearTimer } = {}) {
  if (!sweepTimer) return;
  (clearTimer ?? ((t) => clearInterval(t)))(sweepTimer);
  sweepTimer = null;
}

export async function sweepAll(client, options = {}) {
  for (const guild of client.guilds.cache.values()) {
    try {
      // eslint-disable-next-line no-await-in-loop -- one precinct, and ordering is free
      await refreshTrackedGoals(guild, options);
    } catch (error) {
      logger.warn(`Goals: sweep failed for ${guild.id}:`, error);
    }
  }
}
