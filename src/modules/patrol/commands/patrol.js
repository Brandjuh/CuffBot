import { EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { getPatrolConfig, setPatrolConfig } from '../service.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';

const onOff = (b) => (b ? '🟢 on' : '🔴 off');

export default {
  data: new SlashCommandBuilder()
    .setName('patrol')
    .setDescription('View or switch automated patrol (automod) on/off.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((option) =>
      option
        .setName('action')
        .setDescription('status (default), on, or off')
        .addChoices(
          { name: 'status', value: 'status' },
          { name: 'on', value: 'on' },
          { name: 'off', value: 'off' },
        ),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const action = interaction.options.getString('action') ?? 'status';
    const config = getPatrolConfig(interaction.guild.id);

    if (action === 'on' || action === 'off') {
      config.enabled = action === 'on';
      setPatrolConfig(interaction.guild.id, config);
    }

    const embed = new EmbedBuilder()
      .setColor(config.enabled ? 0x4caf6a : 0x9aa0a6)
      .setTitle('👮 Patrol')
      .setDescription(
        [
          `**Patrol:** ${onOff(config.enabled)}`,
          `**Banned terms:** ${onOff(config.rules.bannedTerms)} (${config.bannedTerms.length} term${config.bannedTerms.length === 1 ? '' : 's'})`,
          `**Invite links:** ${onOff(config.rules.invites)}`,
          `**Spam:** ${onOff(config.rules.spam)}`,
        ].join('\n'),
      )
      .setFooter({ text: 'Toggle rules with /patrol-rule · manage terms with /patrol-term' });

    if (!interaction.client.messageContentAvailable) {
      embed.addFields({
        name: '⚠️ Message Content intent off',
        value: 'Patrol cannot read messages until the Message Content intent is enabled in the Developer Portal.',
      });
    }
    await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
