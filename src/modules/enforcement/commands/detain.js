import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { MAX_TIMEOUT_MS, formatDuration, parseDuration } from '../lib/duration.js';
import { auditReason } from '../lib/audit.js';
import {
  ensureInvokerPermission,
  ensureSensibleTarget,
  fetchMember,
  replyHierarchyBlocked,
} from '../guards.js';
import { addRecord } from '../../records/lib/api.js';
import { logEnforcement } from '../../dispatch/lib/api.js';
import { logger } from '../../../core/logger.js';

export default {
  data: new SlashCommandBuilder()
    .setName('detain')
    .setDescription('Put a member in the holding cell (timeout).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName('target').setDescription('Who goes in the holding cell').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('duration')
        .setDescription('How long: e.g. 10m, 2h, 7d, or 1h30m (max 28d)')
        .setRequired(true)
        .setMaxLength(20),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Why (lands in the audit log)').setMaxLength(400),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members'))) return;
    const target = interaction.options.getUser('target', true);
    if (!(await ensureSensibleTarget(interaction, target))) return;

    const rawDuration = interaction.options.getString('duration', true);
    const ms = parseDuration(rawDuration);
    if (ms === null) {
      await interaction.reply({
        content: `🚫 "${rawDuration}" is not a duration I understand. Use forms like \`10m\`, \`2h\`, \`7d\`, or \`1h30m\`.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (ms > MAX_TIMEOUT_MS) {
      await interaction.reply({
        content: `🚫 Discord caps timeouts at **28 days** — ${formatDuration(ms)} does not fit. For longer removal, consider /arrest.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const member = await fetchMember(interaction, target.id);
    if (!member) {
      await interaction.reply({
        content: `🚫 ${target} is not in the precinct (not a member of this server), so there is nothing to detain.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!member.moderatable) {
      await replyHierarchyBlocked(interaction, target);
      return;
    }

    const reason = interaction.options.getString('reason');
    await member.timeout(ms, auditReason(reason, interaction.user.username));

    let caseNumber = null;
    try {
      caseNumber = addRecord(interaction.guild.id, {
        type: 'detainment',
        userId: target.id,
        officerId: interaction.user.id,
        reason,
        meta: { durationMs: ms },
      }).caseNumber;
    } catch (error) {
      logger.warn('Records unavailable — detainment not filed:', error);
    }

    await interaction.reply(
      `🚔 ${target} detained in the holding cell for **${formatDuration(ms)}** (timeout)${caseNumber ? ` — Case #${caseNumber}` : ''}. Reason: ${reason ?? 'No reason given'}`,
    );

    try {
      await logEnforcement(interaction.guild, {
        type: 'detainment',
        subject: `${target}`,
        officer: `${interaction.user}`,
        reason,
        caseNumber,
        fields: [{ name: 'Duration', value: formatDuration(ms), inline: true }],
      });
    } catch (error) {
      logger.warn('Evidence-locker log failed (detainment):', error);
    }
  },
};
