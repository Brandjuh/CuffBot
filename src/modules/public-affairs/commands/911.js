import { MessageFlags, SlashCommandBuilder } from 'discord.js';
import { reportEmbed } from '../lib/cards.js';
import { sendToEvidenceLocker } from '../../dispatch/lib/api.js';
import { logger } from '../../../core/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('911')
    .setDescription('Report a member to the force. The report goes to the evidence locker.')
    .addUserOption((option) =>
      option.setName('target').setDescription('Who to report').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('What happened').setRequired(true).setMaxLength(500),
    )
    .addBooleanOption((option) =>
      option.setName('anonymous').setDescription('Hide your name from the report (default: false)'),
    ),
  // Text invocation: everything after the target is the reason; the optional
  // `anonymous` flag is only claimed from the tail when it reads as true/false.
  textGreedyArg: 'reason',
  async execute(interaction) {
    const target = interaction.options.getUser('target', true);
    const reason = interaction.options.getString('reason', true);
    const anonymous = interaction.options.getBoolean('anonymous') ?? false;

    const embed = reportEmbed({
      targetLabel: `${target}`,
      targetId: target.id,
      reason,
      reporterLabel: `${interaction.user}`,
      anonymous,
    });

    let result = { delivered: false, reason: 'not-configured' };
    try {
      result = await sendToEvidenceLocker(interaction.guild, embed);
    } catch (error) {
      logger.warn('911: could not deliver report:', error);
    }

    // Always reply to the reporter privately — never echo the report publicly.
    await interaction.reply({
      content: result.delivered
        ? '🚨 Report filed with the force. Thank you — an officer will review it.'
        : '🚨 Report received, but there is no evidence-locker channel configured, so the force may not see it. Ask an admin to run `/evidence-locker action:set`.',
      flags: MessageFlags.Ephemeral,
    });
  },
};
