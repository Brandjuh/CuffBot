// Reaction-mode catches (S66): 🚨 (or 💥) cuffs, 🫡 salutes the undercover
// officer. Works without the Message Content intent — reaction mode is the
// degrade path when the portal toggle is off. Partials are fetched (S22 rule).
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { activeHunt, getHuntingConfig, resolveHunt } from '../service.js';

const CATCH_EMOJI = new Set(['🚨', '💥']);
const SALUTE_EMOJI = '🫡';

export default {
  name: Events.MessageReactionAdd,
  async execute(reaction, user) {
    try {
      if (user?.bot) return;
      if (reaction.partial) await reaction.fetch().catch(() => null);
      const message = reaction.message;
      const guild = message?.guild;
      if (!guild || guild.id !== message.client.config.homeGuildId) return;

      const hunt = activeHunt(message.channelId ?? message.channel?.id);
      if (!hunt) return;
      const config = getHuntingConfig(guild.id);
      if (config.mode !== 'reaction') return;

      const emoji = reaction.emoji?.name ?? '';
      const member = guild.members?.cache?.get(user.id) ?? (await guild.members.fetch(user.id).catch(() => null));
      if (!member) return;
      if (CATCH_EMOJI.has(emoji)) {
        await resolveHunt(message.channel, member, 'catch');
      } else if (emoji === SALUTE_EMOJI && hunt.crook.undercover) {
        await resolveHunt(message.channel, member, 'salute');
      }
    } catch (error) {
      logger.warn('Hunting: reaction handling failed:', error);
    }
  },
};
