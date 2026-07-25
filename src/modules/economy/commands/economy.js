// The donut-economy admin group (S70 = M17.2, `!economy` — the old
// `!economy-config` name stays as an alias). S66 moved the hunt to !hunting.
import { PermissionFlagsBits } from 'discord.js';
import { BIRTHDAY_BONUS, getEconomyConfig, setEconomyConfig } from '../service.js';

export default {
  group: {
    name: 'economy',
    aliases: ['economy-config'],
    description: 'The donut economy: master switch and activity pay (admin).',
    emoji: '💰',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getEconomyConfig(ctx.guild.id);
      return [
        `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
        `**Starting balance:** ${config.startingBalance.toLocaleString('en-US')} 🍩 (everyone starts here)`,
        `**Activity pay:** ${config.earnPerMessage} 🍩 per message (max once per ${Math.round(config.earnCooldownMs / 1000)} s)`,
        `**Birthday gift:** ${BIRTHDAY_BONUS.toLocaleString('en-US')} 🍩 (announced with the birthday message)`,
        `**Heist (${ctx.prefix}steal):** ${(config.heistChance * 100).toFixed(0)}% for ${config.heistAmount} 🍩, cooldown ${Math.round(config.heistCooldownMs / 3_600_000)} h`,
        `**Daily claim:** ${config.claimDay} 🍩 per 24 h (more intervals: \`${ctx.prefix}claims-config\`) · **Pot:** +${config.potDailyTopUp} 🍩/day, crack odds ${(config.potWinChance * 100).toFixed(1)}%`,
        '',
        `_The crook hunt has its own precinct since S66: \`${ctx.prefix}hunting\` (channels, timing, rewards)._`,
      ];
    },
    subcommands: [
      {
        name: 'on',
        description: 'Turn the whole economy on.',
        args: [],
        async run(ctx) {
          setEconomyConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ The donut economy is **open for business**.');
        },
      },
      {
        name: 'off',
        description: 'Turn the whole economy off.',
        args: [],
        async run(ctx) {
          setEconomyConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 The donut economy is **closed**.');
        },
      },
      {
        name: 'earn',
        description: 'Donuts per active message (0–100, default 5).',
        args: [{ name: 'amount', type: 'integer', required: true }],
        async run(ctx, { amount }) {
          if (amount < 0 || amount > 100) {
            await ctx.reply('🚫 Activity pay must be 0–100 🍩 per message.');
            return;
          }
          setEconomyConfig(ctx.guild.id, { earnPerMessage: amount });
          await ctx.reply(`✅ Activity pay set to **${amount} 🍩** per message.`);
        },
      },
    ],
  },
};
