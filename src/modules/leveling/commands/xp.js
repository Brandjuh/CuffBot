// The XP-system admin group (S70 = M17.2, `!xp` — the old `!xp-config` name
// stays as an alias). Bare `!xp` shows settings + the per-rank thresholds.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { isPinnedLadder, ladderForGuild } from '../../academy/service.js';
import { ladderTable, thresholdsFor } from '../lib/xp.js';
import { getUserXp, getXpConfig, setXpConfig } from '../service.js';

const rangeGuard = async (ctx, value, min, max, label) => {
  if (value < min || value > max) {
    await ctx.reply(`🚫 ${label} must be ${min}–${max}.`);
    return false;
  }
  return true;
};

export default {
  group: {
    name: 'xp',
    aliases: ['xp-config', 'xp-ladder'],
    description: 'The XP system: rates, curve, announcements (admin).',
    emoji: '📈',
    permission: PermissionFlagsBits.ManageGuild,
    status(ctx) {
      const config = getXpConfig(ctx.guild.id);
      const ladder = ladderForGuild(ctx.guild);
      const pinned = isPinnedLadder(ctx.guild.id, ladder);
      const thresholds = thresholdsFor(ladder.ranks.length, config);
      // Ladder is highest-first; thresholds are lowest-first — walk from the bottom.
      const ladderLines = ladder.ranks.length
        ? ladder.ranks
            .map((r, i) => {
              const t = thresholds[ladder.ranks.length - 1 - i];
              return `<@&${r.roleId}> — ${t.toLocaleString('en-US')} XP`;
            })
            .join('\n')
        : '_no ladder detected — run `!ranks setup`_';
      return [
        `**Enabled:** ${config.enabled ? 'yes' : 'no'}`,
        `**Auto rank sync:** ${config.syncRoles ? 'yes (promote-only)' : 'no'}`,
        `**Ladder pinned:** ${pinned ? 'yes' : '⚠️ no — auto-rank and rank seeding stay idle until an admin runs `!ranks setup header:@<divider>`'}`,
        `**Message XP:** ${config.messageXp} (cooldown ${Math.round(config.messageCooldownMs / 1000)}s)`,
        `**Voice XP:** ${config.voiceXpPerMin}/min (needs ≥2 humans, not self-deafened, not AFK channel)`,
        `**Curve:** rank N costs round(${config.baseXp.toLocaleString('en-US')} · N^${config.exponent}) — tune with \`${ctx.prefix}xp base\` / \`${ctx.prefix}xp exponent\``,
        `**Announcements:** ${config.announceChannelId ? `<#${config.announceChannelId}>` : '_channel where the promotion happened_'}`,
        '',
        '**Rank thresholds (highest first):**',
        ladderLines,
        '',
        '_Existing members are seeded with the XP of the rank they already hold; new members start at 0._',
      ];
    },
    subcommands: [
      {
        // S106: was `!xp ladder`. Public inside an admin group — the explicit
        // `permission: null` is what drops the group's Manage Server gate, and
        // the overview filters per viewer so a member sees only this line.
        name: 'ladder',
        aliases: ['ranks', 'thresholds'],
        description: 'The XP list: which XP total earns which rank.',
        permission: null,
        args: [],
        async run(ctx) {

          const ladder = ladderForGuild(ctx.guild);
          if (ladder.ranks.length === 0) {
            await ctx.reply(
              '🚫 No rank ladder detected. An admin can point me at the header role with `!ranks setup header:@[LEVELER]`, then try again.',
            );
            return;
          }

          const config = getXpConfig(ctx.guild.id);
          const rows = ladderTable(ladder, config);
          const myXp = getUserXp(ctx.guild.id, ctx.user.id);
          const fmt = (n) => n.toLocaleString('en-US');

          // Mark the tier the invoker's XP has EARNED (which promote-only sync
          // grants; a hand-given higher rank simply sits above this marker).
          let myTier = -1;
          rows.forEach((row, index) => {
            if (myXp >= row.fromXp) myTier = index;
          });
          const marker = (tier) => (myTier === tier ? ` ⬅️ you (${fmt(myXp)} XP)` : '');

          const lines = [
            `**${'0'.padStart(1)} XP** — _no rank yet_${marker(-1)}`,
            ...rows.map((row, index) => `**${fmt(row.fromXp)} XP** — <@&${row.roleId}>${marker(index)}`),
          ];
          const pinNote = isPinnedLadder(ctx.guild.id, ladder)
            ? ''
            : '\n\n⚠️ Ladder not pinned — auto-promotions stay idle until an admin runs `!ranks setup`.';

          const embed = new EmbedBuilder()
            .setColor(0xd4a24e)
            .setTitle('📈 XP Ladder — what earns what')
            .setDescription(`${lines.join('\n')}${pinNote}`.slice(0, 4_000))
            .setFooter({
              text: `XP: ${config.messageXp}/message (max 1 per ${Math.round(config.messageCooldownMs / 1000)} s) + ${config.voiceXpPerMin}/voice minute. Ranks are promote-only.`,
            });
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
      {
        name: 'on',
        description: 'Turn the XP system on.',
        args: [],
        async run(ctx) {
          setXpConfig(ctx.guild.id, { enabled: true });
          await ctx.reply('✅ The XP system is **on**.');
        },
      },
      {
        name: 'off',
        description: 'Turn the XP system off.',
        args: [],
        async run(ctx) {
          setXpConfig(ctx.guild.id, { enabled: false });
          await ctx.reply('📴 The XP system is **off**.');
        },
      },
      {
        name: 'sync',
        description: 'Automatically assign rank roles when XP earns them.',
        args: [{ name: 'state', type: 'boolean', required: true }],
        async run(ctx, { state }) {
          setXpConfig(ctx.guild.id, { syncRoles: state });
          await ctx.reply(state ? '✅ Auto rank sync is **on** (promote-only).' : '📴 Auto rank sync is **off**.');
        },
      },
      {
        name: 'message',
        description: 'XP per message (1–100).',
        args: [{ name: 'amount', type: 'integer', required: true }],
        async run(ctx, { amount }) {
          if (!(await rangeGuard(ctx, amount, 1, 100, 'Message XP'))) return;
          setXpConfig(ctx.guild.id, { messageXp: amount });
          await ctx.reply(`✅ Message XP set to **${amount}**.`);
        },
      },
      {
        name: 'voice',
        description: 'XP per minute in voice (1–100).',
        args: [{ name: 'amount', type: 'integer', required: true }],
        async run(ctx, { amount }) {
          if (!(await rangeGuard(ctx, amount, 1, 100, 'Voice XP'))) return;
          setXpConfig(ctx.guild.id, { voiceXpPerMin: amount });
          await ctx.reply(`✅ Voice XP set to **${amount}/min**.`);
        },
      },
      {
        name: 'cooldown',
        description: 'Seconds between message XP awards (10–600).',
        args: [{ name: 'seconds', type: 'integer', required: true }],
        async run(ctx, { seconds }) {
          if (!(await rangeGuard(ctx, seconds, 10, 600, 'The cooldown'))) return;
          setXpConfig(ctx.guild.id, { messageCooldownMs: seconds * 1000 });
          await ctx.reply(`✅ Message XP cooldown set to **${seconds} s**.`);
        },
      },
      {
        name: 'announce',
        description: 'Channel for promotion announcements.',
        args: [{ name: 'channel', type: 'channel', required: true, postable: true }],
        async run(ctx, { channel }) {
          setXpConfig(ctx.guild.id, { announceChannelId: channel.id });
          await ctx.reply(`✅ Promotions are announced in <#${channel.id}>.`);
        },
      },
      {
        name: 'noannounce',
        aliases: ['clear-announce'],
        description: 'Announce promotions in the channel where they happened (default).',
        args: [],
        async run(ctx) {
          setXpConfig(ctx.guild.id, { announceChannelId: null });
          await ctx.reply('✅ Promotions are announced where they happen.');
        },
      },
      {
        name: 'base',
        aliases: ['base-xp'],
        description: 'XP the LOWEST rank costs (50–100000) — all thresholds scale from this.',
        args: [{ name: 'amount', type: 'integer', required: true }],
        async run(ctx, { amount }) {
          if (!(await rangeGuard(ctx, amount, 50, 100_000, 'Base XP'))) return;
          setXpConfig(ctx.guild.id, { baseXp: amount });
          await ctx.reply(`✅ Base XP set to **${amount.toLocaleString('en-US')}** — all rank thresholds rescale.`);
        },
      },
      {
        name: 'exponent',
        description: 'Curve steepness: rank N costs base·N^exp (1.0–3.0).',
        args: [{ name: 'value', type: 'number', required: true }],
        async run(ctx, { value }) {
          if (value < 1 || value > 3) {
            await ctx.reply('🚫 The exponent must be between 1.0 and 3.0.');
            return;
          }
          setXpConfig(ctx.guild.id, { exponent: value });
          await ctx.reply(`✅ Curve exponent set to **${value}** — all rank thresholds rescale.`);
        },
      },
    ],
  },
};
