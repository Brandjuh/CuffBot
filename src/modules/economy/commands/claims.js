// The claims group (`!claims`). S106 folded `!claims` in: the admin
// knobs are now subcommands of the command members already use, and the
// retired name stays a group alias.
//
// Bare `!claims` still shows your timers — `invokeWithoutSubcommand` (Red's
// `invoke_without_command`) keeps the daily ritual exactly as it was, and
// `!claims true` / `!claims collect:yes` still collect.
//
// The group is UNGATED; every admin subcommand carries Manage Server, and the
// overview filters per viewer, so a member sees only `collect`.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { CLAIM_INTERVALS, formatWaitMs } from '../lib/bank.js';
import {
  claimAll,
  getEconomyConfig,
  hasPotTryToday,
  peekClaim,
  setEconomyConfig,
} from '../service.js';

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
  // S106: the group is public now (members run `!claims`), so every admin
  // subcommand declares its own gate instead of inheriting one.
  permission: PermissionFlagsBits.ManageGuild,
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
    name: 'claims',
    aliases: ['claims-config'],
    description:
      'Your claim timers (hourly/daily/weekly/…) and pot attempt; admins set the amounts.',
    emoji: '🍩',
    fallback: 'collect',
    invokeWithoutSubcommand: true,
    subcommands: [
      {
        // S106: what bare `!claims` and `!claims true` run.
        name: 'collect',
        aliases: ['show', 'timers'],
        description:
          'Your claim timers and pot attempt — collect everything ready at once.',
        args: [{ name: 'collect', type: 'boolean' }],
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
            : `✅ **Pot attempt** — still open: \`${ctx.prefix}pot crack\``;

          const embed = new EmbedBuilder()
            .setColor(0xe67e22)
            .setTitle('🍩 Your Claims')
            .setDescription(
              [
                ...(lines.length
                  ? lines
                  : [
                      `_No claim payouts are configured — an admin can enable them with \`${ctx.prefix}claims\`._`,
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

      amountSub('hourly', 'hourly'),
      amountSub('daily', 'daily'),
      amountSub('weekly', 'weekly'),
      amountSub('monthly', 'monthly'),
      amountSub('quarterly', 'quarterly'),
      amountSub('yearly', 'yearly'),
      {
        name: 'streak',
        permission: PermissionFlagsBits.ManageGuild,
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
        permission: PermissionFlagsBits.ManageGuild,
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
