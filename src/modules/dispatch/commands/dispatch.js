// The dispatch group (`!dispatch`). S106 folded `!dispatch locker` in as
// `locker`. Bare `!dispatch <message>` still sends an announcement, via
// `invokeWithoutSubcommand` plus the fallback — so the invocation the force
// already uses is untouched.
import { PermissionFlagsBits } from 'discord.js';
import { clearEvidenceLocker, getEvidenceLocker, setEvidenceLocker } from '../lib/api.js';
import { announcementEmbed } from '../lib/format.js';

export default {
  group: {
    name: 'dispatch',
    aliases: ['evidence-locker'],
    description: 'Announcements to the force, and the evidence-locker log channel.',
    emoji: '🗄️',
    fallback: 'send',
    invokeWithoutSubcommand: true,
    subcommands: [
      {
        // S106: this is what bare `!dispatch <message>` runs.
        name: 'send',
        aliases: ['announce', 'say'],
        description: 'Broadcast an announcement to the precinct (posted in this channel).',
        permission: PermissionFlagsBits.ManageMessages,
        args: [{ name: 'message', type: 'string', required: true, greedy: true, maxLength: 1800 }],
        async run(ctx, { message }) {

          const officer = ctx.user.displayName ?? ctx.user.username;
          await ctx.channel.send({ embeds: [announcementEmbed({ message, officer })] });
        },
      },
      {
        // S106: was `!dispatch locker`.
        name: 'locker',
        aliases: ['evidence', 'evidence-locker'],
        description: 'Configure the evidence locker — the channel that logs enforcement actions.',
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
              ? `🗄️ Evidence locker is <#${current}>. Run \`${ctx.prefix}dispatch locker action:clear\` to disable, or \`action:set\` in another channel to move it.`
              : `🗄️ No evidence locker configured. Run \`${ctx.prefix}dispatch locker action:set\` in the channel you want enforcement actions logged to.`,
            allowedMentions: { parse: [] },
          });
        },
      },
    ],
  },
};
