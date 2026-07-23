import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { expungeRecords } from '../lib/api.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('expunge')
    .setDescription("Erase records from a member's rap sheet (irreversible).")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addUserOption((option) =>
      option.setName('target').setDescription('Whose records to expunge').setRequired(true),
    )
    .addIntegerOption((option) =>
      option
        .setName('case')
        .setDescription('One specific case number (omit to expunge the entire sheet)')
        .setMinValue(1),
    ),
  async execute(interaction) {
    // Erasing history is a management act, one tier above day-to-day moderation.
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const target = interaction.options.getUser('target', true);
    const caseNumber = interaction.options.getInteger('case');
    const { removed } = expungeRecords(interaction.guild.id, target.id, caseNumber);

    if (removed === 0) {
      await interaction.reply({
        content: caseNumber
          ? `Nothing expunged — case #${caseNumber} is not on ${target}'s sheet.`
          : `Nothing expunged — ${target} already has a clean sheet.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.reply({
      content: caseNumber
        ? `🗑️ Case #${caseNumber} expunged from ${target}'s record.`
        : `🗑️ ${target}'s rap sheet expunged — ${removed} record(s) erased.`,
      flags: MessageFlags.Ephemeral,
    });
  },
};
