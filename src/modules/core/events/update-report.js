// Finishes the /update conversation after the restart that killed it. When an
// admin orders an update and it succeeds, the process dies mid-command — so
// the order was remembered in the store, and this boot handler posts the
// outcome in the channel where /update was typed. Stale markers (>30 min, e.g.
// from a crash long ago) are cleared silently.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { getHead, rememberVersion, takeFreshUpdateMarker } from '../update-status.js';
import { resolveSendableChannel } from '../../../core/channels.js';

export default {
  name: Events.ClientReady,
  once: true,
  async execute(client) {
    try {
      const guild = client.guilds.cache.get(client.config.homeGuildId);
      if (!guild) return;
      const marker = takeFreshUpdateMarker(guild.id);
      if (!marker?.channelId) return;
      // A human ordered this one and is about to be told. Record the version
      // now so the unattended announcer (S117) does not repeat it elsewhere.
      const seen = getHead();
      if (seen.head) rememberVersion(guild.id, seen.head);
      const channel = await resolveSendableChannel(guild, marker.channelId);
      if (!channel) return;

      const { head, subject } = seen;
      const requester = marker.requesterId ? `<@${marker.requesterId}> ` : '';
      let content;
      if (marker.kind === 'restart') {
        content = `🔄 ${requester}Restart complete — configuration reloaded, back on duty. 🚔`;
      } else if (head && head !== marker.startedHead) {
        content = `✅ ${requester}Update complete: \`${marker.startedHead}\` → \`${head}\`${subject ? ` — “${subject}”` : ''}. Back on duty. 🚔`;
      } else {
        content = `↩️ ${requester}Back on duty on the SAME version (\`${marker.startedHead}\`) — the update was rolled back or only a restart happened. Details: \`journalctl -u cuffbot-update -n 30\`.`;
      }
      await channel.send({
        content,
        allowedMentions: { users: marker.requesterId ? [marker.requesterId] : [] },
      });
    } catch (error) {
      logger.warn('Update report failed:', error);
    }
  },
};
