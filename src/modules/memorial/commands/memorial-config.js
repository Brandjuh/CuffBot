import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { itemMatchesFeed } from '../lib/rss.js';
import {
  FEEDS,
  channelIdForFeed,
  fetchFeedItems,
  getMemorialConfig,
  getSeen,
  probeFeed,
  roleIdForFeed,
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
    )
    // S61: candidate-source hunting — the bot host has open internet, this
    // session container does not; probe ANY feed URL live from Discord.
    .addStringOption((o) =>
      o.setName('probe').setDescription('Try ANY feed URL live and show what it contains (posts nothing)'),
    )
    // S62: per-feed ping roles adjustable from Discord (the committed
    // firehero role turned out deleted on the live server).
    .addRoleOption((o) =>
      o.setName('officers-role').setDescription('Role pinged for Fallen Officers entries'),
    )
    .addRoleOption((o) =>
      o.setName('firefighters-role').setDescription('Role pinged for Fallen Firefighters entries'),
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
    const officersRole = interaction.options.getRole('officers-role');
    if (officersRole) patch.odmpRoleId = officersRole.id;
    const firefightersRole = interaction.options.getRole('firefighters-role');
    if (firefightersRole) patch.fireheroRoleId = firefightersRole.id;
    const config = Object.keys(patch).length
      ? setMemorialConfig(interaction.guild.id, patch)
      : getMemorialConfig(interaction.guild.id);

    const preview = interaction.options.getBoolean('preview') === true;
    const probeUrl = interaction.options.getString('probe');
    if (preview || probeUrl) await interaction.deferReply({ flags: 64 });

    let probeLines = [];
    if (probeUrl) {
      const probe = await probeFeed(probeUrl);
      if (!probe.ok) {
        const reasons = {
          'bad-url': '⚠️ That is not an http(s) URL.',
          http: `⚠️ The feed answered HTTP ${probe.status}.`,
          unreachable: `⚠️ Unreachable: ${probe.message}`,
        };
        probeLines = [`**Probe** ${probeUrl}`, reasons[probe.code] ?? '⚠️ Probe failed.'];
      } else {
        probeLines = [
          `**Probe** ${probeUrl}`,
          `${probe.total} item(s) parsed${probe.total ? ' — newest first:' : ' — empty or not RSS.'}`,
          ...probe.sample.map((s, i) => `${i + 1}. [${s.title}](${s.link ?? probeUrl})`),
        ];
      }
    }

    const seen = getSeen(interaction.guild.id);
    const feedLines = [];
    for (const feed of FEEDS) {
      const baselined = Array.isArray(seen[feed.id]) ? `${seen[feed.id].length} seen` : 'not baselined yet';
      let latest = '';
      if (preview) {
        const items = await fetchFeedItems(feed);
        if (items === null) {
          latest = '\n   latest: _feed unreachable right now_';
        } else {
          const matching = items.filter((i) => itemMatchesFeed(feed.match, i));
          const filterNote = feed.match ? ` (${matching.length} of ${items.length} pass the memorial filter)` : '';
          latest = matching.length
            ? `\n   latest: [${matching[0].title}](${matching[0].link ?? feed.url})${filterNote}`
            : `\n   latest: _no matching entries in the feed right now_${filterNote}`;
        }
      }
      const target = channelIdForFeed(config, feed.id);
      const where = target
        ? `<#${target}>${config[`${feed.id}ChannelId`] ? '' : ' (shared)'}`
        : '⚠️ no channel';
      // S62: a deleted role renders as @unknown-role — say so out loud, with
      // the exact option that fixes it.
      const pingRoleId = roleIdForFeed(config, feed);
      const roleLabel = !pingRoleId
        ? 'no ping'
        : interaction.guild.roles.cache.has(pingRoleId)
          ? `<@&${pingRoleId}>`
          : `⚠️ role \`${pingRoleId}\` no longer exists — set a new one with \`${feed.id === 'odmp' ? 'officers-role:' : 'firefighters-role:'}\``;
      feedLines.push(`${feed.emoji} **${feed.title}** → ${roleLabel} in ${where} (${baselined})${latest}`);
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
          ...(probeLines.length ? ['', ...probeLines] : []),
          '',
          '_First sweep baselines each feed (no history flood); new entries post after that, sweeping every 30 minutes._',
        ].join('\n'),
      );
    if (preview || probeUrl) await interaction.editReply({ embeds: [embed] });
    else await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
