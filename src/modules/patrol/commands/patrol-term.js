import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getPatrolConfig, setPatrolConfig } from '../service.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('patrol-term')
    .setDescription('Add or remove a banned term from the patrol list.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('add or remove')
        .setRequired(true)
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }),
    )
    .addStringOption((option) =>
      option.setName('term').setDescription('The term (matched evasion-aware)').setRequired(true).setMaxLength(100),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const action = interaction.options.getString('action', true);
    const term = interaction.options.getString('term', true).trim().toLowerCase();
    const config = getPatrolConfig(interaction.guild.id);
    const terms = new Set(config.bannedTerms);

    let message;
    if (action === 'remove') {
      message = terms.delete(term)
        ? `👮 Removed banned term. ${terms.size} remain.`
        : `“${term}” was not on the banned-term list.`;
    } else if (terms.has(term)) {
      message = `“${term}” is already on the list.`;
    } else {
      terms.add(term);
      message = `👮 Added banned term. ${terms.size} now on the list.`;
    }
    config.bannedTerms = [...terms];
    setPatrolConfig(interaction.guild.id, config);
    // The term itself is not echoed publicly — the reply is ephemeral and
    // deliberately avoids repeating it.
    await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
  },
};
