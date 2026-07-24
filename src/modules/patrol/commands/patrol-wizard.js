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
    // path has none, so point it at the slash form instead of half-working.
    if (interaction.isTextCommand) {
      await interaction.reply({
        content: '👮 The setup wizard is interactive — please run it as the slash command: `/patrol-wizard`.',
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
