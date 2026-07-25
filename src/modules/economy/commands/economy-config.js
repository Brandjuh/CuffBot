import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { BIRTHDAY_BONUS, getEconomyConfig, setEconomyConfig } from '../service.js';

// S66: the hunt options moved to /hunting with the crook hunt itself.
export default {
  data: new SlashCommandBuilder()
    .setName('economy-config')
    .setDescription('View or change the donut economy (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addBooleanOption((o) => o.setName('enabled').setDescription('Master switch for the whole economy'))
    .addIntegerOption((o) =>
      o
        .setName('earn')
        .setDescription('Donuts per active message (default 5)')
        .setMinValue(0)
        .setMaxValue(100),
    ),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;

    const patch = {};
    const enabled = interaction.options.getBoolean('enabled');
    const earn = interaction.options.getInteger('earn');
    if (enabled !== null) patch.enabled = enabled;
    if (earn !== null) patch.earnPerMessage = earn;
    const config = Object.keys(patch).length
      ? setEconomyConfig(interaction.guild.id, patch)
      : getEconomyConfig(interaction.guild.id);

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('🍩 Donut Economy')
      .setDescription(
        [
          `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
          `**Starting balance:** ${config.startingBalance.toLocaleString('en-US')} 🍩 (everyone starts here)`,
          `**Activity pay:** ${config.earnPerMessage} 🍩 per message (max once per ${Math.round(config.earnCooldownMs / 1000)} s)`,
          `**Birthday gift:** ${BIRTHDAY_BONUS.toLocaleString('en-US')} 🍩 (announced with the birthday message)`,
          `**Heist (/steal):** ${(config.heistChance * 100).toFixed(0)}% for ${config.heistAmount} 🍩, cooldown ${Math.round(config.heistCooldownMs / 3_600_000)} h`,
          `**Daily claim:** ${config.claimDay} 🍩 per 24 h (more intervals: \`/claims-config\`) · **Pot:** +${config.potDailyTopUp} 🍩/day, crack odds ${(config.potWinChance * 100).toFixed(1)}%`,
          '',
          '_The crook hunt has its own precinct since S66: `!hunting` (channels, timing, rewards)._',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
