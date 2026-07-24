import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import {
  FEEDS,
  channelIdForFeed,
  fetchFeedItems,
  getMemorialConfig,
  getSeen,
  setMemorialConfig,
} from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('memorial-config')
    .setDescription('View or change the fallen-heroes tracker (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the memorial tracker on/off'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel where new entries are honored')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addBooleanOption((o) =>
      o.setName('preview').setDescription('Fetch each feed now and show its latest entry (nothing is posted)'),
    )
    // S60 options appended LAST (S44 rule: text-path args are positional).
    .addChannelOption((o) =>
      o
        .setName('officers-channel')
        .setDescription('Own channel for Fallen Officers entries (wins over channel:)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addChannelOption((o) =>
      o
        .setName('firefighters-channel')
        .setDescription('Own channel for Fallen Firefighters entries (wins over channel:)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    if (enabled !== null) patch.enabled = enabled;
    if (channel) patch.channelId = channel.id;
    const officersChannel = interaction.options.getChannel('officers-channel');
    if (officersChannel) patch.odmpChannelId = officersChannel.id;
    const firefightersChannel = interaction.options.getChannel('firefighters-channel');
    if (firefightersChannel) patch.fireheroChannelId = firefightersChannel.id;
    const config = Object.keys(patch).length
      ? setMemorialConfig(interaction.guild.id, patch)
      : getMemorialConfig(interaction.guild.id);

    const preview = interaction.options.getBoolean('preview') === true;
    if (preview) await interaction.deferReply({ flags: 64 });

    const seen = getSeen(interaction.guild.id);
    const feedLines = [];
    for (const feed of FEEDS) {
      const baselined = Array.isArray(seen[feed.id]) ? `${seen[feed.id].length} seen` : 'not baselined yet';
      let latest = '';
      if (preview) {
        const items = await fetchFeedItems(feed);
        latest = items.length ? `\n   latest: [${items[0].title}](${items[0].link ?? feed.url})` : '\n   latest: _feed unreachable right now_';
      }
      const target = channelIdForFeed(config, feed.id);
      const where = target
        ? `<#${target}>${config[`${feed.id}ChannelId`] ? '' : ' (shared)'}`
        : '⚠️ no channel';
      feedLines.push(`${feed.emoji} **${feed.title}** → <@&${feed.roleId}> in ${where} (${baselined})${latest}`);
    }

    const embed = new EmbedBuilder()
      .setColor(0x2c3e50)
      .setTitle('🕯️ Memorial Tracker')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Shared fallback channel:** ${config.channelId ? `<#${config.channelId}>` : 'none — each feed needs its own channel below'}`,
          '',
          ...feedLines,
          '',
          '_First sweep baselines each feed (no history flood); new entries post after that, sweeping every 30 minutes._',
        ].join('\n'),
      );
    if (preview) await interaction.editReply({ embeds: [embed] });
    else await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
