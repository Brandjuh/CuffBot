import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getPatrolConfig, setPatrolConfig } from '../service.js';
import { replyEphemeral } from '../../academy/service.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';

const RULES = { bannedTerms: 'Banned terms', invites: 'Invite links', spam: 'Spam' };

export default {
  data: new SlashCommandBuilder()
    .setName('patrol-rule')
    .setDescription('Switch a patrol rule category on or off.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('rule')
        .setDescription('Which rule')
        .setRequired(true)
        .addChoices(...Object.entries(RULES).map(([value, name]) => ({ name, value }))),
    )
    .addStringOption((option) =>
      option
        .setName('state')
        .setDescription('on or off')
        .setRequired(true)
        .addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const rule = interaction.options.getString('rule', true);
    const state = interaction.options.getString('state', true);
    if (!(rule in RULES)) {
      await replyEphemeral(interaction, `🚫 Unknown rule “${rule}”.`);
      return;
    }
    const config = getPatrolConfig(interaction.guild.id);
    config.rules[rule] = state === 'on';
    setPatrolConfig(interaction.guild.id, config);
    await replyEphemeral(interaction, `👮 ${RULES[rule]} screening switched **${state}**.`);
  },
};
