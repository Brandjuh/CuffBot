import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { setGuildData } from '../../../core/store.js';
import { ACADEMY_CONFIG_KEY, getAcademyConfig, replyEphemeral } from '../service.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { scheduleLadderReconcile } from '../../leveling/service.js';

// Some roles sit under the header but are not ranks (dividers, cosmetic roles).
// Exclude them so /promote and /demote skip them.
export default {
  data: new SlashCommandBuilder()
    .setName('rank-exclude')
    .setDescription('Add or remove a role from the rank-ladder exclusion list.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption((option) =>
      option.setName('role').setDescription('The non-rank role to exclude (or re-include)').setRequired(true),
    )
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('add (default) or remove')
        .addChoices({ name: 'add', value: 'add' }, { name: 'remove', value: 'remove' }),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const role = interaction.options.getRole('role', true);
    const action = interaction.options.getString('action') ?? 'add';
    const config = getAcademyConfig(interaction.guild.id);
    const set = new Set(config.excludedRoleIds);

    if (action === 'remove') {
      if (!set.delete(role.id)) {
        await replyEphemeral(interaction, `${role} was not on the exclusion list.`);
        return;
      }
    } else {
      set.add(role.id);
    }
    config.excludedRoleIds = [...set];
    setGuildData(interaction.guild.id, ACADEMY_CONFIG_KEY, config);
    // Cross-module seam: excluding/re-including changes the ladder structure
    // without any role event firing — let leveling reconcile quietly.
    try {
      scheduleLadderReconcile(interaction.guild, { delayMs: 2_000 });
    } catch {
      /* reconciliation is best-effort */
    }
    await replyEphemeral(
      interaction,
      action === 'remove'
        ? `🎖️ ${role} re-included in the rank ladder.`
        : `🎖️ ${role} excluded from the rank ladder. Run \`/ranks\` to verify.`,
    );
  },
};
