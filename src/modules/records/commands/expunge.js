// S93 (M17.3 slice A): converted to the flat { command } shape. Erasing
// history is a management act, one tier above day-to-day moderation — hence
// Manage Server rather than the Moderate Members that `!rapsheet` asks for.
import { PermissionFlagsBits } from 'discord.js';
import { expungeRecords } from '../lib/api.js';

export default {
  command: {
    name: 'expunge',
    description: "Erase records from a member's rap sheet (irreversible).",
    emoji: '🗑️',
    permission: PermissionFlagsBits.ManageGuild,
    args: [
      { name: 'target', type: 'user', required: true },
      { name: 'case', type: 'integer', min: 1 }, // omit to expunge the whole sheet
    ],
    async run(ctx, { target, case: caseNumber = null }) {
      const { removed } = expungeRecords(ctx.guild.id, target.id, caseNumber);

      if (removed === 0) {
        await ctx.reply(
          caseNumber
            ? `Nothing expunged — case #${caseNumber} is not on ${target}'s sheet.`
            : `Nothing expunged — ${target} already has a clean sheet.`,
        );
        return;
      }
      await ctx.reply(
        caseNumber
          ? `🗑️ Case #${caseNumber} expunged from ${target}'s record.`
          : `🗑️ ${target}'s rap sheet expunged — ${removed} record(s) erased.`,
      );
    },
  },
};
