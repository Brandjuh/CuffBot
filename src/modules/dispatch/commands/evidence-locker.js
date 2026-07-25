// Configure the evidence locker — the channel that logs enforcement actions.
//
// "set" uses the channel the command is run in rather than taking a channel
// argument: it matches the "run this in the log channel" convention, and it
// sidestepped the old adapter's inability to resolve channel mentions.
//
// S95 (M17.3 slice C): converted to the flat { command } shape.
// `!evidence-locker action:set` — the form the manuals, `!911`'s reply and
// this command's own status line all advertise — works, and so does the bare
// `!evidence-locker set`.
import { PermissionFlagsBits } from 'discord.js';
import { clearEvidenceLocker, getEvidenceLocker, setEvidenceLocker } from '../lib/api.js';

export default {
  command: {
    name: 'evidence-locker',
    description: 'Configure the evidence locker — the channel that logs enforcement actions.',
    emoji: '🗄️',
    permission: PermissionFlagsBits.ManageGuild,
    args: [{ name: 'action', type: 'string', choices: ['status', 'set', 'clear'] }], // default: status
    async run(ctx, { action = 'status' }) {
      const guildId = ctx.guild.id;

      if (action === 'set') {
        setEvidenceLocker(guildId, ctx.channel.id);
        await ctx.reply(
          `🗄️ Evidence locker set to ${ctx.channel}. Enforcement actions will be logged here.`,
        );
        return;
      }
      if (action === 'clear') {
        clearEvidenceLocker(guildId);
        await ctx.reply(
          '🗄️ Evidence locker cleared. Enforcement actions will no longer be logged to a channel.',
        );
        return;
      }

      const current = getEvidenceLocker(guildId);
      await ctx.reply({
        content: current
          ? `🗄️ Evidence locker is <#${current}>. Run \`${ctx.prefix}evidence-locker action:clear\` to disable, or \`action:set\` in another channel to move it.`
          : `🗄️ No evidence locker configured. Run \`${ctx.prefix}evidence-locker action:set\` in the channel you want enforcement actions logged to.`,
        allowedMentions: { parse: [] },
      });
    },
  },
};
