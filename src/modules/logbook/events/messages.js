// Message trail: deletes, edits, bulk purges. Content depends on the cache +
// the Message Content intent — partials are reported honestly instead of
// silently dropped. CuffBot's own messages are not logged (its starters,
// announcements and log entries would be noise).
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { messageDeleted, messageEdited, messagesBulkDeleted } from '../lib/logformat.js';
import { postLog } from '../service.js';

const isHome = (guild, client) => guild && guild.id === client.config.homeGuildId;

export const onMessageDelete = {
  name: Events.MessageDelete,
  async execute(message) {
    try {
      const client = message.client;
      if (!isHome(message.guild, client)) return;
      if (message.author?.id === client.user.id) return;
      await postLog(
        message.guild,
        messageDeleted({
          authorTag: message.author?.tag ?? message.author?.username,
          authorId: message.author?.id,
          channelId: message.channelId,
          content: message.partial ? null : message.content,
          attachmentCount: message.attachments?.size ?? 0,
          partial: Boolean(message.partial || !message.author),
        }),
        { sourceChannelId: message.channelId },
      );
    } catch (error) {
      logger.warn('Logbook: delete log failed:', error);
    }
  },
};

export const onMessageUpdate = {
  name: Events.MessageUpdate,
  async execute(oldMessage, newMessage) {
    try {
      const client = newMessage.client;
      if (!isHome(newMessage.guild, client)) return;
      if (newMessage.author?.bot) return; // embeds resolving on bot posts spam updates
      const before = oldMessage?.partial ? null : oldMessage?.content ?? null;
      const after = newMessage.partial ? null : newMessage.content ?? null;
      if (before !== null && before === after) return; // embed/pin updates, not an edit
      if (before === null && after === null) return;
      await postLog(
        newMessage.guild,
        messageEdited({
          authorTag: newMessage.author?.tag ?? 'unknown',
          authorId: newMessage.author?.id,
          channelId: newMessage.channelId,
          before,
          after,
          url: newMessage.url,
        }),
        { sourceChannelId: newMessage.channelId },
      );
    } catch (error) {
      logger.warn('Logbook: edit log failed:', error);
    }
  },
};

export const onMessageBulkDelete = {
  name: Events.MessageBulkDelete,
  async execute(messages, channel) {
    try {
      const client = channel.client;
      if (!isHome(channel.guild, client)) return;
      await postLog(
        channel.guild,
        messagesBulkDeleted({ count: messages.size ?? 0, channelId: channel.id }),
        { sourceChannelId: channel.id },
      );
    } catch (error) {
      logger.warn('Logbook: bulk-delete log failed:', error);
    }
  },
};
