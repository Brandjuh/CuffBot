import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { isPinnedLadder, ladderForGuild } from '../../academy/service.js';
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
    )
    .addBooleanOption((o) =>
      o
        .setName('clear-announce')
        .setDescription('Reset announcements back to "the channel where the promotion happened"'),
    )
    // S45 tuning knobs — LAST so the text path's positional order stays stable.
    .addIntegerOption((o) =>
      o
        .setName('base-xp')
        .setDescription('XP the LOWEST rank costs (50–100000) — all thresholds scale from this')
        .setMinValue(50)
        .setMaxValue(100_000),
    )
    .addNumberOption((o) =>
      o
        .setName('exponent')
        .setDescription('Curve steepness: rank N costs base·N^exp (1.0–3.0)')
        .setMinValue(1)
        .setMaxValue(3),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const syncRoles = interaction.options.getBoolean('sync-roles');
    const messageXp = interaction.options.getInteger('message-xp');
    const voiceXp = interaction.options.getInteger('voice-xp');
    const cooldown = interaction.options.getInteger('cooldown');
    const baseXp = interaction.options.getInteger('base-xp');
    const exponent = interaction.options.getNumber('exponent');
    const announce = interaction.options.getChannel('announce');
    const clearAnnounce = interaction.options.getBoolean('clear-announce');
    if (enabled !== null) patch.enabled = enabled;
    if (syncRoles !== null) patch.syncRoles = syncRoles;
    if (messageXp !== null) patch.messageXp = messageXp;
    if (voiceXp !== null) patch.voiceXpPerMin = voiceXp;
    if (cooldown !== null) patch.messageCooldownMs = cooldown * 1000;
    if (baseXp !== null) patch.baseXp = baseXp;
    if (exponent !== null) patch.exponent = exponent;
    if (announce) patch.announceChannelId = announce.id;
    else if (clearAnnounce === true) patch.announceChannelId = null;

    const config = Object.keys(patch).length
      ? setXpConfig(interaction.guild.id, patch)
      : getXpConfig(interaction.guild.id);

    const ladder = ladderForGuild(interaction.guild);
    const pinned = isPinnedLadder(interaction.guild.id, ladder);
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
          `**Ladder pinned:** ${pinned ? 'yes' : '⚠️ no — auto-rank and rank seeding stay idle until an admin runs `/rank-setup header:@<divider>`'}`,
          `**Message XP:** ${config.messageXp} (cooldown ${Math.round(config.messageCooldownMs / 1000)}s)`,
          `**Voice XP:** ${config.voiceXpPerMin}/min (needs ≥2 humans, not self-deafened, not AFK channel)`,
          `**Curve:** rank N costs round(${config.baseXp.toLocaleString('en-US')} · N^${config.exponent}) — tune with \`base-xp\`/\`exponent\``,
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
