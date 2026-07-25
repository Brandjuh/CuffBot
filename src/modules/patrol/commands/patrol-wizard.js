import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { getPatrolConfig, startWizardDraft } from '../service.js';
import { renderOverview } from '../wizard-ui.js';

export default {
  data: new SlashCommandBuilder()
    .setName('patrol-wizard')
    .setDescription('Guided setup for the patrol automod — pick rules, add terms, review, done (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    // Buttons/selects/modals need real component interactions — the text
    // path has none yet — the wizard gets its text-only shape in the Red-style
    // restructure (S69, owner directive); until then the classic commands work.
    if (interaction.isTextCommand) {
      await interaction.reply({
        content: '👮 The interactive setup wizard is being rebuilt for text-only mode (S69). Meanwhile: `!patrol`, `!patrol-rule`, and `!patrol-term` configure everything.',
        flags: 64,
      });
      return;
    }

    const config = getPatrolConfig(interaction.guild.id);
    // The draft starts from what is configured today, so re-running the
    // wizard edits the live setup instead of starting from scratch.
    startWizardDraft(interaction.guild.id, interaction.user.id, {
      rules: { ...config.rules },
      bannedTerms: [...config.bannedTerms],
    });
    await interaction.reply({ ...renderOverview(config), flags: 64 });
  },
};
