// Admin knobs for the payday-style claims (S67 = M16.2). Six interval
// amounts (0 = off), one streak bonus, and the percent-mode toggle.
import { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { ensureInvokerPermission } from '../../enforcement/guards.js';
import { CLAIM_INTERVALS } from '../lib/bank.js';
import { getEconomyConfig, setEconomyConfig } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('claims-config')
    .setDescription('Configure the claim payouts: amounts per interval and the streak bonus (admin).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addIntegerOption((o) => o.setName('hourly').setDescription('Donuts per hourly claim (0 = off)').setMinValue(0).setMaxValue(1_000_000))
    .addIntegerOption((o) => o.setName('daily').setDescription('Donuts per daily claim (0 = off)').setMinValue(0).setMaxValue(1_000_000))
    .addIntegerOption((o) => o.setName('weekly').setDescription('Donuts per weekly claim (0 = off)').setMinValue(0).setMaxValue(1_000_000))
    .addIntegerOption((o) => o.setName('monthly').setDescription('Donuts per monthly claim (0 = off)').setMinValue(0).setMaxValue(1_000_000))
    .addIntegerOption((o) => o.setName('quarterly').setDescription('Donuts per quarterly claim (0 = off)').setMinValue(0).setMaxValue(1_000_000))
    .addIntegerOption((o) => o.setName('yearly').setDescription('Donuts per yearly claim (0 = off)').setMinValue(0).setMaxValue(1_000_000))
    .addIntegerOption((o) => o.setName('streak-bonus').setDescription('Streak bonus (0 = streaks off)').setMinValue(0).setMaxValue(1_000_000))
    .addBooleanOption((o) => o.setName('streak-percent').setDescription('Bonus = base × floor(bonus/100) instead of a flat amount')),
  async execute(interaction) {
    if (!(await ensureInvokerPermission(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const guildId = interaction.guild.id;

    const patch = {};
    const optionToKey = {
      hourly: 'claimHour',
      daily: 'claimDay',
      weekly: 'claimWeek',
      monthly: 'claimMonth',
      quarterly: 'claimQuarter',
      yearly: 'claimYear',
      'streak-bonus': 'streakBonus',
    };
    for (const [opt, key] of Object.entries(optionToKey)) {
      const value = interaction.options.getInteger(opt);
      if (value !== null) patch[key] = value;
    }
    const percent = interaction.options.getBoolean('streak-percent');
    if (percent !== null) patch.streakPercent = percent;
    const config = Object.keys(patch).length
      ? setEconomyConfig(guildId, patch)
      : getEconomyConfig(guildId);

    const amountKey = (key) => `claim${key[0].toUpperCase()}${key.slice(1)}`;
    const rows = CLAIM_INTERVALS.map((i) => {
      const amount = config[amountKey(i.key)];
      return `**${i.label}:** ${amount > 0 ? `${amount.toLocaleString('en-US')} 🍩` : 'off'}`;
    });
    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('🍩 Claims — configuration')
      .setDescription(
        [
          ...rows,
          '',
          `**Streak bonus:** ${config.streakBonus > 0 ? `${config.streakBonus}${config.streakPercent ? ` → base × ${Math.floor(config.streakBonus / 100)} (percent mode)` : ' 🍩 flat'} — earned by claiming within double the window` : 'off'}`,
          '',
          '_Members use `/claims` (overview + collect-all) or `/daily`._',
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
