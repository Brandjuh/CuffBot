import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { getWelcomeConfig, postWelcome, renderWelcome, setWelcomeConfig } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('welcome-config')
    .setDescription('View or change the newcomer welcome (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn welcome messages on/off'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel where newcomers are greeted')
        .addChannelTypes(ChannelType.GuildText),
    )
    .addStringOption((o) =>
      o.setName('message').setDescription('Custom welcome text — {user} = mention, {server} = server name'),
    )
    .addBooleanOption((o) =>
      o.setName('test').setDescription('Post the welcome right now with YOU as the newcomer'),
    ),
  // Free-text option for "!welcome-config" custom messages.
  textGreedyArg: 'message',
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    const message = interaction.options.getString('message');
    if (enabled !== null) patch.enabled = enabled;
    if (channel) patch.channelId = channel.id;
    if (message) patch.message = message.slice(0, 1_500);
    const config = Object.keys(patch).length
      ? setWelcomeConfig(interaction.guild.id, patch)
      : getWelcomeConfig(interaction.guild.id);

    let testLine = '';
    if (interaction.options.getBoolean('test') === true) {
      const sent = await postWelcome(interaction.guild, interaction.user.id, {
        displayName: interaction.member?.displayName,
      });
      testLine = sent
        ? `\n🧪 **Test:** welcome posted in <#${config.channelId}>.`
        : '\n⚠️ **Test failed:** check that the channel exists and CuffBot can send there.';
    }

    // The join event needs the privileged Server Members Intent — surface its
    // state here so a silent welcomer is explainable in one glance.
    const intentLine = interaction.client.memberEventsAvailable
      ? '✅ Server Members Intent is active — joins are detected.'
      : '⚠️ **Server Members Intent is OFF** — the bot cannot see joins! Enable it: Developer Portal → Bot → Privileged Gateway Intents → Server Members Intent, then `/restart`.';

    const preview = renderWelcome(config.message, {
      userMention: `<@${interaction.user.id}>`,
      serverName: interaction.guild.name,
    });
    const embed = new EmbedBuilder()
      .setColor(0x27ae60)
      .setTitle('👋 Newcomer Welcome')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set'}`,
          `**Preview:** ${preview.slice(0, 500)}`,
          '',
          intentLine + testLine,
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } });
  },
};
