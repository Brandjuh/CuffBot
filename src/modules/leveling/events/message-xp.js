// Message XP. Fires on every guild message; the cooldown in lib/xp.js keeps
// spam from paying. Only the EVENT is needed (GuildMessages intent), not the
// message text — so message XP keeps working even when the privileged Message
// Content intent is off. On a promotion the member's rank role is synced
// (promote-only) and announced.
import { Events } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { ladderForGuild } from '../../academy/service.js';
import {
  announceRankUp,
  awardMessageXp,
  getXpConfig,
  syncMemberRank,
} from '../service.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    const client = message.client;
    if (message.author?.bot || !message.guild || !message.member) return;
    // System messages (join notices, boosts) are authored by the user but are
    // not chat — they must not pay XP or trigger seeding.
    if (message.system) return;
    if (message.guild.id !== client.config.homeGuildId) return;

    const config = getXpConfig(message.guild.id);
    if (!config.enabled) return;

    try {
      const ladder = ladderForGuild(message.guild);
      const { gained, xp } = awardMessageXp(
        message.guild.id,
        message.member,
        ladder,
        config,
        Date.now(),
      );
      if (gained === 0) return;

      const sync = await syncMemberRank(message.member, ladder, xp, config);
      if (sync.changed) {
        await announceRankUp(message.guild, message.member, sync, config, message.channel);
      }
    } catch (error) {
      // XP must never break message handling — log and move on.
      logger.warn('Leveling: message XP failed:', error);
    }
  },
};
