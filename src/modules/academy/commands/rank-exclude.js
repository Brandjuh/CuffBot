// Some roles sit under the header but are not ranks (dividers, cosmetic roles).
// Exclude them so !promote and !demote skip them.
//
// S94 (M17.3 slice B): converted to the flat { command } shape. Both
// `!rank-exclude @role remove` and `!rank-exclude @role action:remove` work —
// the manual documents the second form.
import { PermissionFlagsBits } from 'discord.js';
import { setGuildData } from '../../../core/store.js';
import { ACADEMY_CONFIG_KEY, getAcademyConfig, replyEphemeral } from '../service.js';
import { scheduleLadderReconcile } from '../../leveling/service.js';

export default {
  command: {
    name: 'rank-exclude',
    description: 'Add or remove a role from the rank-ladder exclusion list.',
    emoji: '🎖️',
    permission: PermissionFlagsBits.ManageGuild,
    args: [
      { name: 'role', type: 'role', required: true },
      { name: 'action', type: 'string', choices: ['add', 'remove'] }, // default: add
    ],
    async run(ctx, { role, action = 'add' }) {
      const config = getAcademyConfig(ctx.guild.id);
      const set = new Set(config.excludedRoleIds);

      if (action === 'remove') {
        if (!set.delete(role.id)) {
          await replyEphemeral(ctx, `${role} was not on the exclusion list.`);
          return;
        }
      } else {
        set.add(role.id);
      }
      config.excludedRoleIds = [...set];
      setGuildData(ctx.guild.id, ACADEMY_CONFIG_KEY, config);
      // Cross-module seam: excluding/re-including changes the ladder structure
      // without any role event firing — let leveling reconcile quietly.
      try {
        scheduleLadderReconcile(ctx.guild, { delayMs: 2_000 });
      } catch {
        /* reconciliation is best-effort */
      }
      await replyEphemeral(
        ctx,
        action === 'remove'
          ? `🎖️ ${role} re-included in the rank ladder.`
          : `🎖️ ${role} excluded from the rank ladder. Run \`${ctx.prefix}ranks\` to verify.`,
      );
    },
  },
};
