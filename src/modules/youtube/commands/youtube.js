import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { MAX_CREATORS } from '../lib/feed.js';
import {
  addCreator,
  getCreators,
  getYouTubeConfig,
  previewYouTube,
  removeCreator,
  setYouTubeConfig,
} from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('youtube')
    .setDescription('Announce YouTube uploads: manage creators and the announcement channel (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Master switch for upload announcements'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel where new uploads are posted')
        .addChannelTypes(ChannelType.GuildText),
    )
    .addStringOption((o) =>
      o
        .setName('add')
        .setDescription('Creator to follow: channel ID (UC…), channel URL, or @handle'),
    )
    .addStringOption((o) =>
      o.setName('remove').setDescription('Creator to unfollow (name or channel ID)'),
    )
    .addBooleanOption((o) =>
      o.setName('preview').setDescription('Show each creator’s latest video (fetches live, posts nothing)'),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const guildId = interaction.guild.id;
    // Feed fetches (add/preview) can take seconds.
    await interaction.deferReply({ flags: 64 });

    const notes = [];
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    const patch = {};
    if (enabled !== null) patch.enabled = enabled;
    if (channel) patch.channelId = channel.id;
    if (Object.keys(patch).length) setYouTubeConfig(guildId, patch);

    const add = interaction.options.getString('add');
    if (add) {
      const result = await addCreator(guildId, add);
      if (result.ok) {
        notes.push(
          `✅ Now following **${result.name}**${result.latest ? ` (latest: *${result.latest}*)` : ''} — existing videos are NOT reposted; only new uploads from now on.`,
        );
      } else {
        const reasons = {
          'bad-input': '⚠️ Could not read that — paste a channel ID (`UC…`), a `youtube.com/channel/…` URL, or an `@handle`.',
          'fetch-failed': '⚠️ YouTube did not answer for that channel — check the ID/handle and try again.',
          exists: `ℹ️ Already following **${result.name ?? 'that creator'}**.`,
          full: `⚠️ Roster full (${MAX_CREATORS} creators max) — remove one first.`,
        };
        notes.push(reasons[result.code] ?? '⚠️ Could not add that creator.');
      }
    }

    const remove = interaction.options.getString('remove');
    if (remove) {
      const removed = removeCreator(guildId, remove);
      notes.push(removed ? `🗑️ Stopped following **${removed}**.` : 'ℹ️ No creator matched that name/ID.');
    }

    if (interaction.options.getBoolean('preview') === true) {
      const lines = await previewYouTube(guildId);
      notes.push(lines.length ? lines.join('\n') : 'ℹ️ No creators on the roster yet.');
    }

    const config = getYouTubeConfig(guildId);
    const creators = getCreators(guildId);
    const roster = Object.entries(creators)
      .map(([id, c]) => `📺 **${c.name}** — \`${id}\``)
      .join('\n');
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('📺 YouTube Upload Announcements')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set — nothing posts until an admin picks one'}`,
          `**Checked:** every 10 minutes (plus right after a restart)`,
          '',
          `**Following (${Object.keys(creators).length}/${MAX_CREATORS}):**`,
          roster || '_nobody yet — add one with `add:`_',
          ...(notes.length ? ['', ...notes] : []),
        ].join('\n'),
      );
    await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
  },
};
