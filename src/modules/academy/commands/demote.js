import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { planDemotion } from '../lib/ladder.js';
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
    .setName('demote')
    .setDescription('Demote a member one rank down the ladder (or straight to a lower rank role).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((option) =>
      option.setName('target').setDescription('Who to demote').setRequired(true),
    )
    .addRoleOption((option) =>
      option.setName('to').setDescription('Jump straight to this rank role instead of one rung down'),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageRoles, 'Manage Roles'))) return;
    const target = interaction.options.getUser('target', true);
    const toRole = interaction.options.getRole('to');
    const member = await fetchMember(interaction, target.id);
    if (!member) {
      await replyEphemeral(interaction, `🚫 ${target} is not in the precinct, so there is no one to demote.`);
      return;
    }

    const ladder = resolveLadder(interaction);
    const memberRoleIds = [...member.roles.cache.keys()];
    const plan = planDemotion(ladder, memberRoleIds, toRole?.id ?? null);
    if (!plan.ok) {
      await replyEphemeral(interaction, planErrorMessage(plan, `${target}`));
      return;
    }
    if (!(await ensureManageableRoles(interaction, [plan.addRoleId, ...plan.removeRoleIds]))) return;

    await applyRankChange(member, plan, interaction.user.username);
    await interaction.reply(`📉 ${target} busted down: **${plan.from}** → **${plan.to}**.`);
  },
};
