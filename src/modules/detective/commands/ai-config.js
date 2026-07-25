import { ChannelType, EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { getAiConfig, setAiConfig, detectiveStatus, pendingCount } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ai-config')
    .setDescription('View or change the detective (AI) settings (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the detective on/off'))
    .addChannelOption((o) =>
      o
        .setName('channel')
        .setDescription('The ONLY channel where /ask and mention-replies work (S51)')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
    )
    .addBooleanOption((o) =>
      o.setName('everywhere').setDescription('Lift the channel restriction — AI answers anywhere'),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const channel = interaction.options.getChannel('channel');
    if (enabled !== null) patch.enabled = enabled;
    if (channel) patch.channelId = channel.id;
    else if (interaction.options.getBoolean('everywhere') === true) patch.channelId = null;
    if (Object.keys(patch).length) setAiConfig(interaction.guild.id, patch);
    const config = getAiConfig(interaction.guild.id);

    const s = detectiveStatus(interaction.guild.id);
    const embed = new EmbedBuilder()
      .setColor(0x5b4bb5)
      .setTitle('🕵️ Detective (AI) Settings')
      .setDescription(
        [
          `**Enabled:** ${s.enabled ? 'yes' : 'no'}`,
          `**Channel:** ${config.channelId ? `<#${config.channelId}> — the detective only answers there (S51)` : 'everywhere'}`,
          `**Provider:** ${s.provider ? `${s.provider} (model \`${s.model}\`)` : '⚠️ none — add `GROQ_API_KEY` or `GEMINI_API_KEY` to `.env` and restart'}`,
          `**Rate limit (server-wide, everyone combined):** 1 question / 7 s · max 62 / hour${s.maxPerDay ? ` · max ${s.maxPerDay} / day (free ${s.provider} tier)` : ''}`,
          `**Used this hour:** ${s.usedThisHour} / ${s.maxPerHour}${s.maxPerDay ? ` · **today:** ${s.usedToday} / ${s.maxPerDay}` : ''}`,
          ...(s.tpm ? [`**Token budget (est.):** ${s.tokensThisMinute.toLocaleString('en-US')} / ${s.tpm.toLocaleString('en-US')} this minute${s.tpd ? ` · ${s.tokensToday.toLocaleString('en-US')} / ${s.tpd.toLocaleString('en-US')} today` : ''}`] : []),
          `**Desk pile (parked questions):** ${pendingCount()}`,
          `**Conversation memory:** last ${s.historyLimits.maxHistoryEntries} exchanges per channel, ${Math.round(s.historyLimits.historyTtlMs / 60000)} min`,
          '',
          'Talk to the detective with `!ask`, `!ask …`, or by mentioning the bot in a message.',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
