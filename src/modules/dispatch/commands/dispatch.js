import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { announcementEmbed } from '../lib/format.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';

export default {
  data: new SlashCommandBuilder()
    .setName('dispatch')
    .setDescription('Broadcast an announcement to the precinct (posted in this channel).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((option) =>
      option
        .setName('message')
        .setDescription('What to announce')
        .setRequired(true)
        .setMaxLength(1800),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageMessages, 'Manage Messages'))) return;
    const message = interaction.options.getString('message', true);
    const officer = interaction.user.displayName ?? interaction.user.username;
    await interaction.channel.send({ embeds: [announcementEmbed({ message, officer })] });
    await interaction.reply({ content: '📣 Dispatched.', flags: MessageFlags.Ephemeral });
  },
};
