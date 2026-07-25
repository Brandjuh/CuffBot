// S94 (M17.3 slice B): converted to the flat { command } shape. `to:` is a
// keyword arg — it jumps straight to a rank instead of moving one rung.
import { PermissionFlagsBits } from 'discord.js';
import { planDemotion } from '../lib/ladder.js';
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
    name: 'demote',
    description: 'Demote a member one rank down the ladder (or straight to a lower rank role).',
    emoji: '🎖️',
    permission: PermissionFlagsBits.ManageRoles,
    args: [
      { name: 'target', type: 'user', required: true },
      { name: 'to', type: 'role' }, // to:@Rank — jump instead of one rung down
    ],
    async run(ctx, { target, to: toRole = null }) {
      const member = await fetchMember(ctx, target.id);
      if (!member) {
        await replyEphemeral(ctx, `🚫 ${target} is not in the precinct, so there is no one to demote.`);
        return;
      }

      const ladder = resolveLadder(ctx);
      const memberRoleIds = [...member.roles.cache.keys()];
      const plan = planDemotion(ladder, memberRoleIds, toRole?.id ?? null);
      if (!plan.ok) {
        await replyEphemeral(ctx, planErrorMessage(plan, `${target}`));
        return;
      }
      if (!(await ensureManageableRoles(ctx, [plan.addRoleId, ...plan.removeRoleIds]))) return;

      await applyRankChange(member, plan, ctx.user.username);
      // Cross-module seam: cap the member's XP at the demoted-to rank's floor —
      // otherwise their old XP would earn the higher rank right back on their
      // next message, making a human demotion meaningless. Best-effort.
      try {
        coupleXpToRank(ctx.guild.id, target.id, ladder, plan.toRoleId, 'demote');
      } catch {
        // leveling trouble never blocks a demotion that already succeeded
      }
      await ctx.reply(`📉 ${target} busted down: **${plan.from}** → **${plan.to}**.`);
    },
  },
};
