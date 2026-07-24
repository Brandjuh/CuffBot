// Every 5 minutes: if the configured channel has been quiet long enough (and
// a human has spoken since the last starter), post an open-ended question.
// At boot the idle clock is seeded from the channel's REAL last message, so
// "12 hours of silence" survives restarts instead of resetting to boot time.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { shouldPost } from '../lib/starter.js';
import {
  activityFor,
  getStarterConfig,
  postStarter,
  seedActivityFromHistory,
} from '../service.js';

export const SWEEP_INTERVAL_MS = 5 * 60_000;

export async function sweepStarter(guild, now = Date.now()) {
  const config = getStarterConfig(guild.id);
  if (!config.enabled || !config.channelId) return false;
  const channel = guild.channels.cache.get(config.channelId);
  if (!channel?.send) return false;

  const entry = activityFor(config.channelId, now);
  const verdict = shouldPost({
    config,
    idleMs: now - entry.lastActivityAt,
    humanSinceStarter: entry.humanSinceStarter,
  });
  if (!verdict.post) return false;
  return postStarter(guild, config, now);
}

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      const guild = client.guilds.cache.get(client.config.homeGuildId);
      if (guild) {
        await seedActivityFromHistory(guild, getStarterConfig(guild.id), client.user?.id);
      }
    } catch (error) {
      logger.warn('Chat-starter: boot seed failed:', error);
    }
    const tick = async () => {
      try {
        const guild = client.guilds.cache.get(client.config.homeGuildId);
        if (guild) await sweepStarter(guild);
      } catch (error) {
        logger.warn('Chat-starter: sweep failed:', error);
      }
    };
    const timer = setInterval(tick, SWEEP_INTERVAL_MS);
    timer.unref?.();
  },
};
