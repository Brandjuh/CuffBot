// Admin knobs for the payday-style claims (S67 = M16.2; group since S70).
// One sub per interval amount (0 = off), plus the streak bonus and its mode.
import { PermissionFlagsBits } from 'discord.js';
import { CLAIM_INTERVALS } from '../lib/bank.js';
import { getEconomyConfig, setEconomyConfig } from '../service.js';

const INTERVAL_KEYS = {
  hourly: 'claimHour',
  daily: 'claimDay',
  weekly: 'claimWeek',
  monthly: 'claimMonth',
  quarterly: 'claimQuarter',
  yearly: 'claimYear',
};

const amountSub = (name, label) => ({
  name,
  description: `Donuts per ${label} claim (0 = off).`,
  args: [{ name: 'amount', type: 'integer', required: true }],
  async run(ctx, { amount }) {
    if (amount < 0 || amount > 1_000_000) {
      await ctx.reply('🚫 The amount must be 0–1000000 (0 turns the interval off).');
      return;
    }
    setEconomyConfig(ctx.guild.id, { [INTERVAL_KEYS[name]]: amount });
    await ctx.reply(
      amount > 0
        ? `✅ The ${label} claim pays **${amount.toLocaleString('en-US')} 🍩**.`
        : `📴 The ${label} claim is **off**.`,
    );
  },
});

export default {
  group: {
    name: 'claims-config',
    description: 'Claim payouts: amounts per interval and the streak bonus (admin).',
    emoji: '🍩',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getEconomyConfig(ctx.guild.id);
      const amountKey = (key) => `claim${key[0].toUpperCase()}${key.slice(1)}`;
      const rows = CLAIM_INTERVALS.map((i) => {
        const amount = config[amountKey(i.key)];
        return `**${i.label}:** ${amount > 0 ? `${amount.toLocaleString('en-US')} 🍩` : 'off'}`;
      });
      return [
        ...rows,
        '',
        `**Streak bonus:** ${config.streakBonus > 0 ? `${config.streakBonus}${config.streakPercent ? ` → base × ${Math.floor(config.streakBonus / 100)} (percent mode)` : ' 🍩 flat'} — earned by claiming within double the window` : 'off'}`,
        '',
        `_Members use \`${ctx.prefix}claims\` (overview + collect-all) or \`${ctx.prefix}daily\`._`,
      ];
    },
    subcommands: [
      amountSub('hourly', 'hourly'),
      amountSub('daily', 'daily'),
      amountSub('weekly', 'weekly'),
      amountSub('monthly', 'monthly'),
      amountSub('quarterly', 'quarterly'),
      amountSub('yearly', 'yearly'),
      {
        name: 'streak',
        description: 'Streak bonus for claiming within double the window (0 = streaks off).',
        args: [{ name: 'amount', type: 'integer', required: true }],
        async run(ctx, { amount }) {
          if (amount < 0 || amount > 1_000_000) {
            await ctx.reply('🚫 The bonus must be 0–1000000 (0 turns streaks off).');
            return;
          }
          setEconomyConfig(ctx.guild.id, { streakBonus: amount });
          await ctx.reply(amount > 0 ? `✅ Streak bonus set to **${amount.toLocaleString('en-US')}**.` : '📴 Streaks are **off**.');
        },
      },
      {
        name: 'streakmode',
        description: 'flat = bonus donuts as-is; percent = base × floor(bonus/100).',
        args: [{ name: 'mode', type: 'string', required: true, choices: ['flat', 'percent'] }],
        async run(ctx, { mode }) {
          setEconomyConfig(ctx.guild.id, { streakPercent: mode === 'percent' });
          await ctx.reply(
            mode === 'percent'
              ? '✅ Streak mode: **percent** — bonus = base × floor(bonus/100).'
              : '✅ Streak mode: **flat** — the bonus is added as-is.',
          );
        },
      },
    ],
  },
};
