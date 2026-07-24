// Finishes the /update conversation after the restart that killed it. When an
// admin orders an update and it succeeds, the process dies mid-command — so
// the order was remembered in the store, and this boot handler posts the
// outcome in the channel where /update was typed. Stale markers (>30 min, e.g.
// from a crash long ago) are cleared silently.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { getHead, takeFreshUpdateMarker } from '../update-status.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      const guild = client.guilds.cache.get(client.config.homeGuildId);
      if (!guild) return;
      const marker = takeFreshUpdateMarker(guild.id);
      if (!marker?.channelId) return;
      const channel = guild.channels.cache.get(marker.channelId);
      if (!channel?.send) return;

      const { head, subject } = getHead();
      const requester = marker.requesterId ? `<@${marker.requesterId}> ` : '';
      const content =
        head && head !== marker.startedHead
          ? `✅ ${requester}Update complete: \`${marker.startedHead}\` → \`${head}\`${subject ? ` — “${subject}”` : ''}. Back on duty. 🚔`
          : `↩️ ${requester}Back on duty on the SAME version (\`${marker.startedHead}\`) — the update was rolled back or only a restart happened. Details: \`journalctl -u cuffbot-update -n 30\`.`;
      await channel.send({
        content,
        allowedMentions: { users: marker.requesterId ? [marker.requesterId] : [] },
      });
    } catch (error) {
      logger.warn('Update report failed:', error);
    }
  },
};
