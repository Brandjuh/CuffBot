import { ChannelType, EmbedBuilder, MessageFlags, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { displayEmoji, parseEmojiInput } from '../lib/board.js';
import { getBoardedData, getStarboardConfig, setStarboardConfig } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('starboard-config')
    .setDescription('View or change the commendation board (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the starboard on/off'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('Channel where starred messages are reposted')
        .addChannelTypes(ChannelType.GuildText),
    )
    .addIntegerOption((o) =>
      o.setName('threshold').setDescription('Stars needed to board a message (1–25)').setMinValue(1).setMaxValue(25),
    )
    .addStringOption((o) =>
      o
        .setName('emoji')
        .setDescription('Reaction that counts: a unicode emoji (🌟) or a custom server emoji (:name:)'),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    const threshold = interaction.options.getInteger('threshold');
    const emojiRaw = interaction.options.getString('emoji');
    if (enabled !== null) patch.enabled = enabled;
    if (channel) patch.channelId = channel.id;
    if (threshold !== null) patch.threshold = threshold;
    if (emojiRaw !== null) {
      const parsed = parseEmojiInput(emojiRaw);
      if (!parsed.ok) {
        await interaction.reply({
          content:
            `🚫 \`${emojiRaw}\` is not an emoji I can watch for. Use a unicode emoji (like 🌟 or 🍩) ` +
            'or pick a custom server emoji from the emoji picker so it looks like `<:name:id>`.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      patch.emoji = parsed.value;
    }
    const config = Object.keys(patch).length
      ? setStarboardConfig(interaction.guild.id, patch)
      : getStarboardConfig(interaction.guild.id);

    const boardedCount = (getBoardedData(interaction.guild.id).order ?? []).length;
    const embed = new EmbedBuilder()
      .setColor(0xf5b041)
      .setTitle('⭐ Commendation Board')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Channel:** ${config.channelId ? `<#${config.channelId}>` : '⚠️ not set — nothing is boarded until an admin picks one'}`,
          `**Threshold:** ${config.threshold} × ${displayEmoji(config.emoji)}`,
          `**Boarded so far:** ${boardedCount}`,
          '',
          `React with ${displayEmoji(config.emoji)} on any message; at ${config.threshold} reactions it earns a spot on the board. Each message boards once.`,
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
