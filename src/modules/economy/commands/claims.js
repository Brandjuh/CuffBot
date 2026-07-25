// The claims overview (S67 = M16.2, payday port): every interval's state,
// your crack-pot attempt, and a collect-all — one embed for the daily ritual.
import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { CLAIM_INTERVALS, formatWaitMs } from '../lib/bank.js';
import { claimAll, getEconomyConfig, hasPotTryToday, peekClaim } from '../service.js';

export default {
  data: new SlashCommandBuilder()
    .setName('claims')
    .setDescription('Your claim timers (hourly/daily/weekly/…) and pot attempt — collect everything at once.')
    .addBooleanOption((o) => o.setName('collect').setDescription('Claim every payout that is available right now')),
  async execute(interaction) {
    const guildId = interaction.guild.id;
    const userId = interaction.user.id;
    const config = getEconomyConfig(guildId);
    if (!config.enabled) {
      await interaction.reply({ content: '🍩 The economy is currently disabled.', flags: 64 });
      return;
    }

    let collectLine = null;
    if (interaction.options.getBoolean('collect') === true) {
      const result = claimAll(guildId, userId);
      collectLine = result.claimed.length
        ? `💰 Collected **${(result.total + result.totalBonus).toLocaleString('en-US')} 🍩**` +
          (result.totalBonus > 0 ? ` (incl. **${result.totalBonus.toLocaleString('en-US')}** streak bonus)` : '') +
          ` from ${result.claimed.map((r) => r.key).join(', ')}.`
        : 'ℹ️ Nothing is ready to collect right now.';
    }

    const lines = [];
    for (const interval of CLAIM_INTERVALS) {
      const verdict = peekClaim(guildId, userId, interval.key);
      if (verdict.code === 'off') continue;
      lines.push(
        verdict.code === 'claim'
          ? `✅ **${interval.label}** — ${verdict.amount} 🍩 ready${verdict.bonus > 0 ? ` (+${verdict.bonus} streak)` : ''}`
          : `⏳ **${interval.label}** — fresh in ~${formatWaitMs(verdict.waitMs)}`,
      );
    }
    const potLine = hasPotTryToday(guildId, userId)
      ? '❌ **Pot attempt** — used for today (midnight UTC resets it)'
      : '✅ **Pot attempt** — still open: `!crack-pot`';

    const embed = new EmbedBuilder()
      .setColor(0xe67e22)
      .setTitle('🍩 Your Claims')
      .setDescription(
        [
          ...(lines.length ? lines : ['_No claim payouts are configured — an admin can enable them with `!claims-config`._']),
          potLine,
          ...(config.streakBonus > 0
            ? ['', `_Streaks: claim again within double the window for +${config.streakPercent ? `${Math.floor(config.streakBonus / 100)}× the base` : `${config.streakBonus} 🍩`}._`]
            : []),
          ...(collectLine ? ['', collectLine] : ['', '_Collect everything at once: `!claims true`_']),
        ].join('\n'),
      );
    await interaction.reply({ embeds: [embed], flags: 64 });
  },
};
