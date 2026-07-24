import { ChannelType, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { refreshList, removeList, setChannellistConfig, withListLock } from '../service.js';

const RESULTS = {
  unchanged: '📋 The channel list is already up to date.',
  edited: '📋 Channel list updated — the existing messages were edited in place.',
  posted: '📋 Channel list posted.',
  reposted: '📋 Channel list reposted.',
  unconfigured: '⚠️ No list channel set yet — run `/channel-list action:post channel:#…` once.',
  'missing-channel':
    '⚠️ The configured channel no longer exists — pick a new one with `/channel-list action:post channel:#…`.',
  forbidden: '⚠️ I need permission to view and send messages in the configured channel.',
};

export default {
  data: new SlashCommandBuilder()
    .setName('channel-list')
    .setDescription('Post, update or remove the channel directory (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addStringOption((o) =>
      o
        .setName('action')
        .setDescription('What to do with the posted list')
        .setRequired(true)
        .addChoices(
          { name: 'post — (re)post the full list', value: 'post' },
          { name: 'update — refresh, editing in place when possible', value: 'update' },
          { name: 'remove — delete the posted list', value: 'remove' },
        ),
    )
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('With post: publish the list in this channel')
        .addChannelTypes(ChannelType.GuildText),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const action = interaction.options.getString('action');
    const channel = interaction.options.getChannel('channel');
    // Rendering + posting several embeds can exceed the 3-second window.
    await interaction.deferReply({ flags: 64 });

    if (action === 'remove') {
      const removed = await removeList(interaction.guild);
      await interaction.editReply(
        removed ? '🗑️ Channel list removed.' : 'ℹ️ There is no posted channel list to remove.',
      );
      return;
    }

    if (channel) setChannellistConfig(interaction.guild.id, { channelId: channel.id });
    const result = await withListLock(interaction.guild.id, () =>
      refreshList(interaction.guild, { forceRepost: action === 'post' }),
    );
    await interaction.editReply(RESULTS[result] ?? result);
  },
};
