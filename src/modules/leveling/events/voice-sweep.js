// Voice XP. Instead of bookkeeping join/leave timestamps (fragile across
// restarts and mute/deaf/move edge cases), a 60-second sweep awards one
// minute's XP to everyone CURRENTLY eligible in a voice channel. Eligibility
// (pure, tested): not the AFK channel, at least two humans in the channel, not
// self-deafened, never bots. Requires the GuildVoiceStates intent to see who
// is in voice. The sweep is wall-clock honest: a member present for N sweeps
// earns N minutes, no matter how the session started or ended.
import { ChannelType, Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { ladderForGuild } from '../../academy/service.js';
import { eligibleVoiceMemberIds } from '../lib/xp.js';
import {
  announceRankUp,
  awardVoiceMinutes,
  getXpConfig,
  syncMemberRank,
} from '../service.js';

export const SWEEP_INTERVAL_MS = 60_000;

/** One sweep over the home guild's voice channels. Exported for tests. */
export async function sweepGuild(guild) {
  const config = getXpConfig(guild.id);
  if (!config.enabled) return;
  const ladder = ladderForGuild(guild);

  // Collect every eligible member across all voice channels first, then award
  // the whole tick in ONE store write.
  const toAward = [];
  const voiceChannels = guild.channels.cache.filter(
    (ch) => ch.type === ChannelType.GuildVoice || ch.type === ChannelType.GuildStageVoice,
  );
  for (const channel of voiceChannels.values()) {
    const members = [...channel.members.values()].map((m) => ({
      id: m.id,
      bot: m.user?.bot ?? false,
      selfDeaf: m.voice?.selfDeaf ?? false,
    }));
    const eligible = new Set(
      eligibleVoiceMemberIds(members, { isAfkChannel: channel.id === guild.afkChannelId }),
    );
    for (const member of channel.members.values()) {
      if (eligible.has(member.id)) toAward.push(member);
    }
  }

  for (const { member, xp } of awardVoiceMinutes(guild.id, toAward, ladder, config)) {
    const sync = await syncMemberRank(member, ladder, xp, config);
    if (sync.changed) await announceRankUp(guild, member, sync, config, null);
  }
}

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    const timer = setInterval(async () => {
      try {
        const guild = client.guilds.cache.get(client.config.homeGuildId);
        if (guild) await sweepGuild(guild);
      } catch (error) {
        logger.warn('Leveling: voice sweep failed:', error);
      }
    }, SWEEP_INTERVAL_MS);
    // Never keep the process alive just for the sweep.
    timer.unref?.();
    logger.info('Leveling: voice XP sweep armed (every 60s).');
  },
};
