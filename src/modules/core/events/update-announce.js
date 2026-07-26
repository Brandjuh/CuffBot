// Announce an UNATTENDED update (S117, owner: "Zodra er automatisch een update
// is geïnstalleerd laat dat weten in 412334189879230474").
//
// `update-report.js` finishes the conversation when a human typed `!update`.
// The 15-minute timer has nobody waiting on it, so its updates landed in
// silence — the precinct found out by noticing the bot behaving differently.
//
// This runs at boot because that is when the news is true: every update ends
// with a restart. Doing it here rather than in `scripts/update.sh` keeps the
// bot token out of a shell script, and covers a manual `git pull` too.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { resolveSendableChannel } from '../../../core/channels.js';
import {
  DEFAULT_UPDATE_CHANNEL_ID,
  getHead,
  getSeenVersion,
  rememberVersion,
  updateAnnouncement,
  versionChange,
} from '../update-status.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      const guild = client.guilds.cache.get(client.config.homeGuildId);
      if (!guild) return;

      const current = getHead();
      // `update-report.js` runs on the same event and records the version when
      // a human ordered the update, so by the time this reads it the commit is
      // already marked seen and `versionChange` returns 'unchanged'. Both
      // orderings are safe: the worst case is this announcing an update the
      // requester was also told about, which is why the flag exists at all.
      const verdict = versionChange(current, getSeenVersion(guild.id));

      // The version is recorded whatever we decide, including on first boot —
      // otherwise every restart would re-evaluate the same unknown state.
      if (current.head) rememberVersion(guild.id, current.head);
      if (!verdict.announce) return;

      const channel = await resolveSendableChannel(guild, DEFAULT_UPDATE_CHANNEL_ID);
      if (!channel) {
        logger.warn(`Update announce: channel ${DEFAULT_UPDATE_CHANNEL_ID} is not reachable.`);
        return;
      }
      await channel.send({
        content: updateAnnouncement({ from: verdict.from, to: verdict.to, subject: current.subject }),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      logger.warn('Update announcement failed:', error);
    }
  },
};
