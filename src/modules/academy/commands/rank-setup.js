// S94 (M17.3 slice B): converted to the flat { command } shape.
//
// `!rank-setup header:@[LEVELER]` is the exact line this bot has been telling
// the owner to run since S12 — in STATE's owner-action list, in the academy
// and leveling manuals, and in the `!ranks` / `!xp-ladder` / `!level` replies.
// It never worked on the text path: the adapter was purely positional, so the
// token `header:<@&…>` came back as "`header` should be a mention or id"
// (S68 → S94). The framework's keyword args fix that, and the arg is still
// positional too, so plain `!rank-setup @[LEVELER]` works as well.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { setGuildData } from '../../../core/store.js';
import { ACADEMY_CONFIG_KEY, getAcademyConfig, resolveLadder } from '../service.js';
import { scheduleLadderReconcile } from '../../leveling/service.js';

export default {
  command: {
    name: 'rank-setup',
    description: 'Point CuffBot at the rank-section header role, and show the detected ladder.',
    emoji: '🎖️',
    permission: PermissionFlagsBits.ManageGuild,
    // Omit the header to just view the current config.
    args: [{ name: 'header', type: 'role' }],
    async run(ctx, { header = null }) {
      if (header) {
        const stored = getAcademyConfig(ctx.guild.id);
        stored.headerRoleId = header.id;
        setGuildData(ctx.guild.id, ACADEMY_CONFIG_KEY, stored);
        // Cross-module seam: the pin (re)defines the ladder — let leveling
        // baseline or reconcile. Wrapped: rank setup must never fail on it.
        try {
          scheduleLadderReconcile(ctx.guild, { delayMs: 2_000 });
        } catch {
          /* reconciliation is best-effort */
        }
      }

      const ladder = resolveLadder(ctx);
      const config = getAcademyConfig(ctx.guild.id);
      const embed = new EmbedBuilder().setColor(0xd4a24e).setTitle('🎖️ Rank Ladder Setup');

      const headerLine = config.headerRoleId ? `<@&${config.headerRoleId}>` : '_auto-detected by name_';
      const excludeLine = config.excludedRoleIds.length
        ? config.excludedRoleIds.map((id) => `<@&${id}>`).join(', ')
        : '_none_';
      const detected =
        ladder.headerFound && ladder.ranks.length
          ? ladder.ranks.map((r, i) => `**${i + 1}.** <@&${r.roleId}>`).join('\n')
          : '⚠️ none detected — set the header role, or check exclusions';

      embed.setDescription(
        `**Header:** ${headerLine}\n**Excluded:** ${excludeLine}\n\n**Detected ladder (highest first):**\n${detected}`,
      );
      embed.setFooter({ text: `Remove non-rank roles from the ladder with ${ctx.prefix}rank-exclude.` });
      await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  },
};
