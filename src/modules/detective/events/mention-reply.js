// Talk to the bot by mentioning it: "@Cuffbot how do radios work?" replies in
// the channel through the same pipeline (and the same server-wide rate limit)
// as /ask. Needs the Message Content intent to read the question — degrades to
// silence without it (slash /ask keeps working; the manual documents this).
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { askDetective } from '../service.js';

/** Strip every mention of the bot (and its role form) from the text. */
export function stripBotMention(content, botId) {
  return String(content ?? '')
    .replace(new RegExp(`<@[!&]?${botId}>`, 'g'), ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export default {
  name: Events.MessageCreate,
  async execute(message) {
    const client = message.client;
    try {
      if (!client.messageContentAvailable) return;
      if (message.author?.bot || message.system || !message.guild || !message.member) return;
      if (message.guild.id !== client.config.homeGuildId) return;
      // Only a direct @mention of the bot counts — @everyone/@here and role
      // pings that happen to include the bot must not burn the AI budget.
      if (message.mentions?.everyone) return;
      if (!message.mentions?.users?.has(client.user.id)) return;
      // Prefix commands ("!ask …") route via the prefix router, not this event.
      if (message.content.startsWith(client.config.prefix)) return;

      const question = stripBotMention(message.content, client.user.id);
      await message.channel.sendTyping?.().catch?.(() => {});
      const result = await askDetective({
        guildId: message.guild.id,
        channelId: message.channel.id,
        askerName: message.member.displayName ?? message.author.username,
        question,
        userId: message.author.id,
      });
      await message.reply({
        content: result.ok ? `🕵️ ${result.reply}` : result.message,
        allowedMentions: { parse: [], repliedUser: true },
      });
    } catch (error) {
      logger.warn('Detective: mention reply failed:', error);
    }
  },
};
