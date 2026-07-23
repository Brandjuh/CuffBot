import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { ladderForGuild } from '../../academy/service.js';
import { thresholdsFor } from '../lib/xp.js';
import { getXpConfig, setXpConfig } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('xp-config')
    .setDescription('View or change the XP system settings (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the XP system on/off'))
    .addBooleanOption((o) =>
      o.setName('sync-roles').setDescription('Automatically assign rank roles when XP earns them'),
    )
    .addIntegerOption((o) =>
      o.setName('message-xp').setDescription('XP per message (1–100)').setMinValue(1).setMaxValue(100),
    )
    .addIntegerOption((o) =>
      o
        .setName('voice-xp')
        .setDescription('XP per minute in voice (1–100)')
        .setMinValue(1)
        .setMaxValue(100),
    )
    .addIntegerOption((o) =>
      o
        .setName('cooldown')
        .setDescription('Seconds between message XP awards (10–600)')
        .setMinValue(10)
        .setMaxValue(600),
    )
    .addChannelOption((o) =>
      o
        .setName('announce')
        .setDescription('Channel for promotion announcements (default: where it happened)')
        .addChannelTypes(ChannelType.GuildText),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const syncRoles = interaction.options.getBoolean('sync-roles');
    const messageXp = interaction.options.getInteger('message-xp');
    const voiceXp = interaction.options.getInteger('voice-xp');
    const cooldown = interaction.options.getInteger('cooldown');
    const announce = interaction.options.getChannel('announce');
    if (enabled !== null) patch.enabled = enabled;
    if (syncRoles !== null) patch.syncRoles = syncRoles;
    if (messageXp !== null) patch.messageXp = messageXp;
    if (voiceXp !== null) patch.voiceXpPerMin = voiceXp;
    if (cooldown !== null) patch.messageCooldownMs = cooldown * 1000;
    if (announce) patch.announceChannelId = announce.id;

    const config = Object.keys(patch).length
      ? setXpConfig(interaction.guild.id, patch)
      : getXpConfig(interaction.guild.id);

    const ladder = ladderForGuild(interaction.guild);
    const thresholds = thresholdsFor(ladder.ranks.length, config);
    // Ladder is highest-first; thresholds are lowest-first — walk from the bottom.
    const ladderLines = ladder.ranks.length
      ? ladder.ranks
          .map((r, i) => {
            const t = thresholds[ladder.ranks.length - 1 - i];
            return `<@&${r.roleId}> — ${t.toLocaleString('en-US')} XP`;
          })
          .join('\n')
      : '_no ladder detected — run `/rank-setup`_';

    const embed = new EmbedBuilder()
      .setColor(0x2e86de)
      .setTitle('⚙️ XP System Settings')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Auto rank sync:** ${config.syncRoles ? 'yes (promote-only)' : 'no'}`,
          `**Message XP:** ${config.messageXp} (cooldown ${Math.round(config.messageCooldownMs / 1000)}s)`,
          `**Voice XP:** ${config.voiceXpPerMin}/min (needs ≥2 humans, not self-deafened, not AFK channel)`,
          `**Announcements:** ${config.announceChannelId ? `<#${config.announceChannelId}>` : '_channel where the promotion happened_'}`,
          '',
          '**Rank thresholds (highest first):**',
          ladderLines,
          '',
          '_Existing members are seeded with the XP of the rank they already hold; new members start at 0._',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64, allowedMentions: { parse: [] } });
  },
};
