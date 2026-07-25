// S94 (M17.3 slice B): converted to the flat { command } shape. `to:` is a
// keyword arg — it jumps straight to a rank instead of moving one rung.
import { PermissionFlagsBits } from 'discord.js';
import { planPromotion } from '../lib/ladder.js';
import {
  applyRankChange,
  ensureManageableRoles,
  planErrorMessage,
  replyEphemeral,
  resolveLadder,
} from '../service.js';
import { fetchMember } from '../../enforcement/guards.js';
import { coupleXpToRank } from '../../leveling/service.js';

export default {
  command: {
    name: 'promote',
    description: 'Promote a member one rank up the ladder (or straight to a higher rank role).',
    emoji: '🎖️',
    permission: PermissionFlagsBits.ManageRoles,
    args: [
      { name: 'target', type: 'user', required: true },
      { name: 'to', type: 'role' }, // to:@Rank — jump instead of one rung up
    ],
    async run(ctx, { target, to: toRole = null }) {
      const member = await fetchMember(ctx, target.id);
      if (!member) {
        await replyEphemeral(ctx, `🚫 ${target} is not in the precinct, so there is no one to promote.`);
        return;
      }

      const ladder = resolveLadder(ctx);
      const memberRoleIds = [...member.roles.cache.keys()];
      const plan = planPromotion(ladder, memberRoleIds, toRole?.id ?? null);
      if (!plan.ok) {
        await replyEphemeral(ctx, planErrorMessage(plan, `${target}`));
        return;
      }
      if (!(await ensureManageableRoles(ctx, [plan.addRoleId, ...plan.removeRoleIds]))) return;

      await applyRankChange(member, plan, ctx.user.username);
      // Cross-module seam: couple the member's XP to their new rank (raise to
      // its floor) so the XP system agrees with the human decision. Best-effort.
      try {
        coupleXpToRank(ctx.guild.id, target.id, ladder, plan.toRoleId, 'promote');
      } catch {
        // leveling trouble never blocks a promotion that already succeeded
      }
      await ctx.reply(
        plan.from === null
          ? `🎖️ ${target} inducted at **${plan.to}**.`
          : `🎖️ ${target} promoted: **${plan.from}** → **${plan.to}**.`,
      );
    },
  },
};
