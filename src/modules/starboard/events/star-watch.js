// Reaction watcher: when a message collects enough ⭐, repost it to the
// commendation board. Handles partials (reactions on messages from before
// this boot) by fetching on demand; every failure path is silent-but-logged —
// a reaction must never crash the gateway handlers.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { shouldBoard } from '../lib/board.js';
import { alreadyBoarded, boardMessage, getStarboardConfig } from '../service.js';

export default {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    try {
      if (user?.bot) return;
      if (reaction.partial) reaction = await reaction.fetch();
      let message = reaction.message;
      if (message.partial) message = await message.fetch();
      const guild = message.guild;
      if (!guild || guild.id !== message.client.config.homeGuildId) return;

      const config = getStarboardConfig(guild.id);
      const verdict = shouldBoard({
        emojiName: reaction.emoji?.name ?? '',
        count: reaction.count ?? 0,
        config,
        messageChannelId: message.channelId,
        alreadyBoarded: alreadyBoarded(guild.id, message.id),
      });
      if (!verdict.board) return;

      await boardMessage(
        guild,
        {
          messageId: message.id,
          content: message.content ?? '',
          authorName: message.member?.displayName ?? message.author?.username ?? 'Unknown officer',
          avatarUrl: message.author?.displayAvatarURL?.() ?? null,
          attachments: [...(message.attachments?.values?.() ?? [])].map((a) => ({
            url: a.url,
            contentType: a.contentType ?? null,
          })),
          url: message.url,
          channelId: message.channelId,
          stars: reaction.count ?? config.threshold,
        },
        config,
      );
    } catch (error) {
      logger.warn('Starboard: reaction handling failed:', error);
    }
  },
};
