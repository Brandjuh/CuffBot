import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { getAiConfig, setAiConfig, detectiveStatus } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('ai-config')
    .setDescription('View or change the detective (AI) settings (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Turn the detective on/off')),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const enabled = interaction.options.getBoolean('enabled');
    if (enabled !== null) setAiConfig(interaction.guild.id, { enabled });
    else getAiConfig(interaction.guild.id); // touch nothing on view

    const s = detectiveStatus(interaction.guild.id);
    const embed = new EmbedBuilder()
      .setColor(0x5b4bb5)
      .setTitle('🕵️ Detective (AI) Settings')
      .setDescription(
        [
          `**Enabled:** ${s.enabled ? 'yes' : 'no'}`,
          `**Provider:** ${s.provider ? `${s.provider} (model \`${s.model}\`)` : '⚠️ none — add `GROQ_API_KEY` or `GEMINI_API_KEY` to `.env` and restart'}`,
          `**Rate limit (server-wide, everyone combined):** 1 question / 7 s · max 62 / hour`,
          `**Used this hour:** ${s.usedThisHour} / ${s.maxPerHour}`,
          `**Conversation memory:** last ${s.historyLimits.maxHistoryEntries} exchanges per channel, ${Math.round(s.historyLimits.historyTtlMs / 60000)} min`,
          '',
          'Talk to the detective with `/ask`, `!ask …`, or by mentioning the bot in a message.',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
