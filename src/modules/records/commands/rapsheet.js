import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { recordsFor } from '../lib/api.js';
import { formatRapSheet } from '../lib/format.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('rapsheet')
    .setDescription("Pull up a member's record: citations, detainments, arrests, releases.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) =>
      option.setName('target').setDescription('Whose record to pull').setRequired(true),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ModerateMembers, 'Moderate Members'))) return;
    const target = interaction.options.getUser('target', true);
    const entries = recordsFor(interaction.guild.id, target.id);
    // Ephemeral by design: a member's record is for the force's eyes, not a
    // public shaming board — dispatch/logging arrives in M4 for the rest.
    await interaction.reply({
      content: formatRapSheet(target.displayName ?? target.username, entries),
      flags: MessageFlags.Ephemeral,
    });
  },
};
