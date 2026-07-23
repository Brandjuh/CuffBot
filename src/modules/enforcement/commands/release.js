import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { auditReason } from '../lib/audit.js';
import { ensureInvokerPermission, fetchMember } from '../guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('release')
    .setDescription('Release someone: lift a timeout, or lift a ban.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName('target').setDescription('Who to release').setRequired(true),
    )
    .addStringOption((option) =>
      option.setName('reason').setDescription('Why (lands in the audit log)').setMaxLength(400),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members'))) return;
    const target = interaction.options.getUser('target', true);
    const reason = interaction.options.getString('reason');
    const audit = auditReason(reason, interaction.user.username);

    // Path 1: member present with an active timeout → lift it.
    const member = await fetchMember(interaction, target.id);
    if (member) {
      const detainedUntil = member.communicationDisabledUntilTimestamp;
      if (detainedUntil && detainedUntil > Date.now()) {
        if (!member.moderatable) {
          await interaction.reply({
            content: `🚫 Cannot release ${target}: their highest role is at or above mine.`,
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        await member.timeout(null, audit);
        await interaction.reply(`🔓 ${target} released from the holding cell (timeout lifted).`);
        return;
      }
    }

    // Path 2: banned → unban. Lifting a ban is a bigger power than lifting a
    // timeout, so it demands the invoker's Ban Members permission.
    const ban = await interaction.guild.bans.fetch(target.id).catch(() => null);
    if (ban) {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.BanMembers)) {
        await interaction.reply({
          content: '🚫 Lifting a ban requires the **Ban Members** permission.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.guild.members.unban(target.id, audit);
      await interaction.reply(`🔓 ${target} released — ban lifted. They may rejoin the precinct.`);
      return;
    }

    await interaction.reply({
      content: `${target} is neither detained nor arrested — nothing to release.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
