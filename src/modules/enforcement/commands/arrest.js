import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
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

// Discord accepts 0..604800 seconds (7 days) of message history deletion.
const WIPE_CHOICES = [
  { name: 'Keep all messages', value: 0 },
  { name: 'Wipe last hour', value: 3_600 },
  { name: 'Wipe last 6 hours', value: 21_600 },
  { name: 'Wipe last 24 hours', value: 86_400 },
  { name: 'Wipe last 3 days', value: 259_200 },
  { name: 'Wipe last 7 days', value: 604_800 },
];

export default {
  data: new SlashCommandBuilder()
    .setName('arrest')
    .setDescription('Arrest a member (ban). Works by id even if they already left.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) =>
      option.setName('target').setDescription('Who gets arrested').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Why (lands in the audit log)').setMaxLength(400),
    )
    .addIntegerOption((option) =>
      option
        .setName('wipe')
        .setDescription('How much recent message history to remove')
        .addChoices(...WIPE_CHOICES),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.BanMembers, 'Ban Members'))) return;
    const target = interaction.options.getUser('target', true);
    if (!(await ensureSensibleTarget(interaction, target))) return;

    // Hierarchy only applies when they are still a member; banning a user who
    // already left is a ban by id and always allowed for the bot.
    const member = await fetchMember(interaction, target.id);
    if (member && !member.bannable) {
      await replyHierarchyBlocked(interaction, target);
      return;
    }

    const alreadyBanned = await interaction.guild.bans.fetch(target.id).catch(() => null);
    if (alreadyBanned) {
      await interaction.reply({
        content: `${target} is already under arrest (banned).`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const reason = interaction.options.getString('reason');
    const deleteMessageSeconds = interaction.options.getInteger('wipe') ?? 0;
    await interaction.guild.members.ban(target.id, {
      reason: auditReason(reason, interaction.user.username),
      deleteMessageSeconds,
    });

    let caseNumber = null;
    try {
      caseNumber = addRecord(interaction.guild.id, {
        type: 'arrest',
        userId: target.id,
        officerId: interaction.user.id,
        reason,
        meta: { wipeSeconds: deleteMessageSeconds },
      }).caseNumber;
    } catch (error) {
      logger.warn('Records unavailable — arrest not filed:', error);
    }

    const wipeLabel = deleteMessageSeconds > 0
      ? WIPE_CHOICES.find((c) => c.value === deleteMessageSeconds)?.name.replace('Wipe last ', 'last ') ?? ''
      : '';
    const wipeNote = wipeLabel ? ` Message history wiped: ${wipeLabel}.` : '';
    await interaction.reply(
      `🚨 ${target} has been **arrested** (banned)${caseNumber ? ` — Case #${caseNumber}` : ''}. Reason: ${reason ?? 'No reason given'}.${wipeNote}`,
    );

    try {
      await logEnforcement(interaction.guild, {
        type: 'arrest',
        subject: `${target}`,
        officer: `${interaction.user}`,
        reason,
        caseNumber,
        fields: wipeLabel ? [{ name: 'Message wipe', value: wipeLabel, inline: true }] : [],
      });
    } catch (error) {
      logger.warn('Evidence-locker log failed (arrest):', error);
    }
  },
};
