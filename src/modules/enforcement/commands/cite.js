import {
  AttachmentBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { renderCitationGif } from '../lib/citation-card.js';
import { ensureInvokerPermission, ensureSensibleTarget } from '../guards.js';
import { addRecord } from '../../records/lib/api.js';
import { logEnforcement } from '../../dispatch/lib/api.js';
import { logger } from '../../../core/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('cite')
    .setDescription('Issue a formal citation (warning) — delivered as a Papers-Please-style ticket.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName('target').setDescription('Who receives the citation').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('reason')
        .setDescription('The violation being cited')
        .setRequired(true)
        .setMaxLength(200),
    )
    .addStringOption((option) =>
      option
        .setName('penalty')
        .setDescription('Penalty text on the ticket (default: OFFICIAL WARNING)')
        .setMaxLength(100),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members'))) return;
    const target = interaction.options.getUser('target', true);
    if (!(await ensureSensibleTarget(interaction, target))) return;

    const reason = interaction.options.getString('reason', true);
    const penalty = interaction.options.getString('penalty') ?? undefined;

    const { gif } = renderCitationGif({
      to: target.displayName ?? target.username,
      reason,
      penalty,
      officer: interaction.user.displayName ?? interaction.user.username,
      date: new Date().toISOString().slice(0, 10),
      badgeSeed: target.id,
    });

    // File the case before announcing it, so the reply can carry the number.
    // Records being unavailable must never block a citation (see
    // architecture.md → Cross-module calls).
    let caseNumber = null;
    try {
      caseNumber = addRecord(interaction.guild.id, {
        type: 'citation',
        userId: target.id,
        officerId: interaction.user.id,
        reason,
        meta: penalty ? { penalty } : {},
      }).caseNumber;
    } catch (error) {
      logger.warn('Records unavailable — citation not filed:', error);
    }

    await interaction.reply({
      content: `📋 Citation issued to ${target}${caseNumber ? ` (Case #${caseNumber})` : ''}. Reason: ${reason}`,
      files: [new AttachmentBuilder(gif, { name: 'citation.gif' })],
    });

    // Best-effort DM copy — closed DMs are common and not an error.
    const dmDelivered = await target
      .send({
        content: `📋 You received a citation in **${interaction.guild.name}**.`,
        files: [new AttachmentBuilder(gif, { name: 'citation.gif' })],
      })
      .then(() => true)
      .catch(() => false);
    if (!dmDelivered) {
      await interaction.followUp({
        content: '(No DM copy delivered — their DMs are closed.)',
        flags: MessageFlags.Ephemeral,
      }).catch(() => {});
    }

    try {
      await logEnforcement(interaction.guild, {
        type: 'citation',
        subject: `${target}`,
        officer: `${interaction.user}`,
        reason,
        caseNumber,
        fields: penalty ? [{ name: 'Penalty', value: penalty, inline: true }] : [],
      });
    } catch (error) {
      logger.warn('Evidence-locker log failed (citation):', error);
    }
  },
};
