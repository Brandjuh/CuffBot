// Every 5 minutes: if the configured channel has been quiet long enough (and
// a human has spoken since the last starter), post an open-ended question.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { shouldPost } from '../lib/starter.js';
import { activityFor, getStarterConfig, markStarterPosted, nextQuestion } from '../service.js';

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

  const question = await nextQuestion(guild.id, config);
  if (!question) return false;
  try {
    await channel.send({ content: `💬 **Radio check, precinct!** ${question}`, allowedMentions: { parse: [] } });
    markStarterPosted(config.channelId, now);
    return true;
  } catch (error) {
    logger.warn('Chat-starter: post failed:', error);
    return false;
  }
}

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
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
