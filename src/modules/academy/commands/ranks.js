// The rank group (`!ranks`). S106 folded the hyphenated pair in: `!ranks setup`
// and `!ranks exclude` are now `setup` and `exclude`, so one family is one
// command. Bare `!ranks` still prints the ladder — `invokeWithoutSubcommand`
// (Red's `invoke_without_command`) is what keeps the invocation everyone
// already types doing exactly what it did.
//
// The group is UNGATED so anyone can read the ladder; the two admin
// subcommands carry their own flag, and the overview filters per viewer.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { setGuildData } from '../../../core/store.js';
import { scheduleLadderReconcile } from '../../leveling/service.js';
import { ACADEMY_CONFIG_KEY, getAcademyConfig, replyEphemeral, resolveLadder } from '../service.js';

export default {
  group: {
    name: 'ranks',
    aliases: ['rank', 'rank-setup', 'rank-exclude'],
    description: 'The precinct rank ladder: read it, pin it, exclude roles from it.',
    emoji: '🎖️',
    fallback: 'list',
    invokeWithoutSubcommand: true,
    subcommands: [
      {
        name: 'list',
        aliases: ['show', 'ladder'],
        description: 'Show the rank ladder detected from the server roles.',
        args: [],
        async run(ctx) {

          const ladder = resolveLadder(ctx);
          const embed = new EmbedBuilder().setColor(0xd4a24e).setTitle('🎖️ Precinct Rank Ladder');

          if (!ladder.headerFound || ladder.ranks.length === 0) {
            embed.setDescription(
              'No rank ladder detected yet.\nAn admin can point me at the header role with `!ranks setup header:@[LEVELER]` ' +
                '(the divider your rank roles sit under), then run `!ranks` again.',
            );
            await ctx.reply({ embeds: [embed] });
            return;
          }

          // ranks are highest-first already.
          const lines = ladder.ranks.map((r, i) => `**${i + 1}.** <@&${r.roleId}>`);
          embed.setDescription(lines.join('\n')).setFooter({
            text: `${ladder.ranks.length} ranks · highest first · ${ctx.prefix}promote and ${ctx.prefix}demote walk this ladder`,
          });
          await ctx.reply({ embeds: [embed] });
        },
      },
      {
        // S106: was `!ranks setup`. The `header:` keyword form the docs have
        // advertised since S12 still works — it is an arg name, not a command
        // name, so folding the command left it untouched.
        name: 'setup',
        aliases: ['pin'],
        description: 'Pin the header role the rank roles sit under.',
        permission: PermissionFlagsBits.ManageGuild,
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
          embed.setFooter({ text: `Remove non-rank roles from the ladder with ${ctx.prefix}ranks exclude.` });
          await ctx.reply({ embeds: [embed], allowedMentions: { parse: [] } });
        },
      },
      {
        // S106: was `!ranks exclude`.
        name: 'exclude',
        aliases: ['ignore'],
        description: 'Keep a role out of the ladder.',
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
    ],
  },
};
