// Auto-transcribes voice memos as they land (S101 = M21.1). Like the kill
// counter's watcher, this contains no rules — eligibility and the budget both
// live in the service, where they are tested.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { audioAttachmentsOf } from '../lib/transcribe.js';
import { transcribeMessage } from '../service.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    if (!message.guild || message.author?.bot) return;
    // Cheap gate first: the overwhelming majority of messages carry no audio,
    // and this handler runs on every one of them.
    if (audioAttachmentsOf(message).length === 0) return;

    try {
      const result = await transcribeMessage(message.guild.id, message);
      if (!result.ok) {
        // A refusal on the AUTO path is silent by design: "that channel is not
        // covered" or "no key configured" is a reply to nobody's question, and
        // posting it under every audio file would be noise. The manual command
        // says all of it out loud.
        if (result.reason === 'failed') {
          logger.warn(`Transcribe: ${message.id} failed — ${result.detail}`);
        }
        return;
      }
      await message.reply({
        embeds: [result.embed],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      logger.warn('Transcribe: could not post a transcript:', error);
    }
  },
};
