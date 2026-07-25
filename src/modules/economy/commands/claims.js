// The claims overview (S67 = M16.2, payday port): every interval's state,
// your crack-pot attempt, and a collect-all — one embed for the daily ritual.
//
// S95 (M17.3 slice C): converted to the flat { command } shape. Its own hint
// already advertised `!claims true`, which the boolean arg keeps working;
// `!claims collect:yes` now works too.
import { EmbedBuilder } from 'discord.js';
import { CLAIM_INTERVALS, formatWaitMs } from '../lib/bank.js';
import { claimAll, getEconomyConfig, hasPotTryToday, peekClaim } from '../service.js';

export default {
  command: {
    name: 'claims',
    description:
      'Your claim timers (hourly/daily/weekly/…) and pot attempt — collect everything at once.',
    emoji: '🍩',
    args: [{ name: 'collect', type: 'boolean' }], // true = claim everything ready
    async run(ctx, { collect = false }) {
      const guildId = ctx.guild.id;
      const userId = ctx.user.id;
      const config = getEconomyConfig(guildId);
      if (!config.enabled) {
        await ctx.reply('🍩 The economy is currently disabled.');
        return;
      }

      let collectLine = null;
      if (collect === true) {
        const result = claimAll(guildId, userId);
        collectLine = result.claimed.length
          ? `💰 Collected **${(result.total + result.totalBonus).toLocaleString('en-US')} 🍩**` +
            (result.totalBonus > 0
              ? ` (incl. **${result.totalBonus.toLocaleString('en-US')}** streak bonus)`
              : '') +
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
        : `✅ **Pot attempt** — still open: \`${ctx.prefix}crack-pot\``;

      const embed = new EmbedBuilder()
        .setColor(0xe67e22)
        .setTitle('🍩 Your Claims')
        .setDescription(
          [
            ...(lines.length
              ? lines
              : [
                  `_No claim payouts are configured — an admin can enable them with \`${ctx.prefix}claims-config\`._`,
                ]),
            potLine,
            ...(config.streakBonus > 0
              ? [
                  '',
                  `_Streaks: claim again within double the window for +${config.streakPercent ? `${Math.floor(config.streakBonus / 100)}× the base` : `${config.streakBonus} 🍩`}._`,
                ]
              : []),
            ...(collectLine
              ? ['', collectLine]
              : ['', `_Collect everything at once: \`${ctx.prefix}claims true\`_`]),
          ].join('\n'),
        );
      await ctx.reply({ embeds: [embed] });
    },
  },
};
