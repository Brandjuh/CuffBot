import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { planPromotion } from '../lib/ladder.js';
import {
  applyRankChange,
  ensureManageableRoles,
  planErrorMessage,
  replyEphemeral,
  resolveLadder,
} from '../service.js';
import { ensureInvokerPermission, fetchMember } from '../../enforcement/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote a member one rank up the ladder (or straight to a higher rank role).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((option) =>
      option.setName('target').setDescription('Who to promote').setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName('to').setDescription('Jump straight to this rank role instead of one rung up'),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageRoles, 'Manage Roles'))) return;
    const target = interaction.options.getUser('target', true);
    const toRole = interaction.options.getRole('to');
    const member = await fetchMember(interaction, target.id);
    if (!member) {
      await replyEphemeral(interaction, `🚫 ${target} is not in the precinct, so there is no one to promote.`);
      return;
    }

    const ladder = resolveLadder(interaction);
    const memberRoleIds = [...member.roles.cache.keys()];
    const plan = planPromotion(ladder, memberRoleIds, toRole?.id ?? null);
    if (!plan.ok) {
      await replyEphemeral(interaction, planErrorMessage(plan, `${target}`));
      return;
    }
    if (!(await ensureManageableRoles(interaction, [plan.addRoleId, ...plan.removeRoleIds]))) return;

    await applyRankChange(member, plan, interaction.user.username);
    await interaction.reply(
      plan.from === null
        ? `🎖️ ${target} inducted at **${plan.to}**.`
        : `🎖️ ${target} promoted: **${plan.from}** → **${plan.to}**.`,
    );
  },
};
