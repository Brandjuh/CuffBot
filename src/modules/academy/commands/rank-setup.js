import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { setGuildData } from '../../../core/store.js';
import { ACADEMY_CONFIG_KEY, getAcademyConfig, resolveLadder } from '../service.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { scheduleLadderReconcile } from '../../leveling/service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('rank-setup')
    .setDescription('Point CuffBot at the rank-section header role, and show the detected ladder.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addRoleOption((option) =>
      option
        .setName('header')
        .setDescription('The divider role your rank roles sit under (e.g. [LEVELER]). Omit to just view config.'),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const header = interaction.options.getRole('header');
    if (header) {
      const config = getAcademyConfig(interaction.guild.id);
      config.headerRoleId = header.id;
      setGuildData(interaction.guild.id, ACADEMY_CONFIG_KEY, config);
      // Cross-module seam: the pin (re)defines the ladder — let leveling
      // baseline or reconcile. Wrapped: rank setup must never fail on it.
      try {
        scheduleLadderReconcile(interaction.guild, { delayMs: 2_000 });
      } catch {
        /* reconciliation is best-effort */
      }
    }

    const ladder = resolveLadder(interaction);
    const config = getAcademyConfig(interaction.guild.id);
    const embed = new EmbedBuilder().setColor(0xd4a24e).setTitle('🎖️ Rank Ladder Setup');

    const headerLine = config.headerRoleId ? `<@&${config.headerRoleId}>` : '_auto-detected by name_';
    const excludeLine = config.excludedRoleIds.length
      ? config.excludedRoleIds.map((id) => `<@&${id}>`).join(', ')
      : '_none_';
    const detected = ladder.headerFound && ladder.ranks.length
      ? ladder.ranks.map((r, i) => `**${i + 1}.** <@&${r.roleId}>`).join('\n')
      : '⚠️ none detected — set the header role, or check exclusions';

    embed.setDescription(
      `**Header:** ${headerLine}\n**Excluded:** ${excludeLine}\n\n**Detected ladder (highest first):**\n${detected}`,
    );
    embed.setFooter({ text: 'Remove non-rank roles from the ladder with /rank-exclude.' });
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
