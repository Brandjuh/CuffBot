// Automated screening. Runs on every guild message (when the Message Content
// intent is available), skips moderators, and on a violation removes the
// message, warns the author, and routes a record + evidence-locker entry
// through the cross-module seams — never throwing into the gateway.
import { Events, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { getPatrolConfig } from '../service.js';
import { screenMessage, summarizeViolations } from '../lib/screen.js';
import { addRecord } from '../../records/lib/api.js';
import { logEnforcement } from '../../dispatch/lib/api.js';

export default {
  name: Events.MessageCreate,
  async execute(message) {
    const client = message.client;
    // Needs the Message Content intent; the bot degrades gracefully without it.
    if (!client.messageContentAvailable) return;
    if (message.author?.bot || !message.guild) return;
    if (message.guild.id !== client.config.homeGuildId) return;
    // Moderators and admins are exempt.
    if (message.member?.permissions?.has(PermissionFlagsBits.ManageMessages)) return;

    const config = getPatrolConfig(message.guild.id);
    if (!config.enabled) return;
    const violations = screenMessage(message.content, config);
    if (violations.length === 0) return;

    const summary = summarizeViolations(violations);
    await message.delete().catch(() => {});
    await message.author
      .send(`🚨 Your message in **${message.guild.name}** was removed by patrol: ${summary}.`)
      .catch(() => {});

    let caseNumber = null;
    try {
      caseNumber = addRecord(message.guild.id, {
        type: 'citation',
        userId: message.author.id,
        officerId: client.user.id,
        reason: `Auto-patrol: ${summary}`,
        meta: { patrol: true, violations: violations.map((v) => v.type) },
      }).caseNumber;
    } catch (error) {
      logger.warn('Patrol: records unavailable:', error);
    }
    try {
      await logEnforcement(message.guild, {
        type: 'citation',
        subject: `${message.author}`,
        officer: `${client.user} (patrol)`,
        reason: summary,
        caseNumber,
      });
    } catch (error) {
      logger.warn('Patrol: evidence-locker log failed:', error);
    }
  },
};
