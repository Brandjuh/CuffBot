// The patrol group (`!patrol`). S106 folded the hyphenated trio in:
// `!patrol rule`, `!patrol term` and `!patrol wizard` are now `rule`, `term`
// and `wizard`. Bare `!patrol` still shows the screen status, via
// `invokeWithoutSubcommand`.
import { EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import { getPatrolConfig, setPatrolConfig, startWizardDraft } from '../service.js';
import { renderOverview } from '../wizard-ui.js';

const onOff = (b) => (b ? '🟢 on' : '🔴 off');

const RULES = { bannedTerms: 'Banned terms', invites: 'Invite links', spam: 'Spam' };

export default {
  group: {
    name: 'patrol',
    aliases: ['patrol-rule', 'patrol-term', 'patrol-wizard'],
    description: 'Automod patrol: screening rules, banned terms, and the guided setup.',
    emoji: '👮',
    fallback: 'status',
    invokeWithoutSubcommand: true,
    subcommands: [
      {
        // S106: this is what bare `!patrol` runs.
        name: 'status',
        aliases: ['show', 'settings'],
        description: 'View or switch automated patrol (automod) on/off.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [{ name: 'action', type: 'string', choices: ['status', 'on', 'off'] }], // default: status
        async run(ctx, { action = 'status' }) {

          const config = getPatrolConfig(ctx.guild.id);

          if (action === 'on' || action === 'off') {
            config.enabled = action === 'on';
            setPatrolConfig(ctx.guild.id, config);
          }

          const embed = new EmbedBuilder()
            .setColor(config.enabled ? 0x4caf6a : 0x9aa0a6)
            .setTitle('👮 Patrol')
            .setDescription(
              [
                `**Patrol:** ${onOff(config.enabled)}`,
                `**Banned terms:** ${onOff(config.rules.bannedTerms)} (${config.bannedTerms.length} term${config.bannedTerms.length === 1 ? '' : 's'})`,
                `**Invite links:** ${onOff(config.rules.invites)}`,
                `**Spam:** ${onOff(config.rules.spam)}`,
              ].join('\n'),
            )
            .setFooter({
              text: `Toggle rules with ${ctx.prefix}patrol rule · manage terms with ${ctx.prefix}patrol term · guided setup: ${ctx.prefix}patrol wizard`,
            });

          if (!ctx.client.messageContentAvailable) {
            embed.addFields({
              name: '⚠️ Message Content intent off',
              value:
                'Patrol cannot read messages until the Message Content intent is enabled in the Developer Portal.',
            });
          }
          await ctx.reply({ embeds: [embed] });
        },
      },
      {
        // S106: was `!patrol rule`.
        name: 'rule',
        description: 'Switch a patrol rule category on or off.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
      { name: 'rule', type: 'string', required: true, choices: Object.keys(RULES) },
      { name: 'state', type: 'string', required: true, choices: ['on', 'off'] },
    ],
        async run(ctx, { rule, state }) {

          const config = getPatrolConfig(ctx.guild.id);
          config.rules[rule] = state === 'on';
          setPatrolConfig(ctx.guild.id, config);
          await ctx.reply(`👮 ${RULES[rule]} screening switched **${state}**.`);
        },
      },
      {
        // S106: was `!patrol term`.
        name: 'term',
        description: 'Add or remove a banned term from the patrol list.',
        permission: PermissionFlagsBits.ManageGuild,
        args: [
      { name: 'action', type: 'string', required: true, choices: ['add', 'remove'] },
      // Greedy: a banned term may be a phrase. Matched evasion-aware.
      { name: 'term', type: 'string', required: true, greedy: true, maxLength: 100 },
    ],
        async run(ctx, { action, term: raw }) {

          const term = raw.trim().toLowerCase();
          const config = getPatrolConfig(ctx.guild.id);
          const terms = new Set(config.bannedTerms);

          let message;
          if (action === 'remove') {
            message = terms.delete(term)
              ? `👮 Removed banned term. ${terms.size} remain.`
              : 'That term was not on the banned-term list.';
          } else if (terms.has(term)) {
            message = 'That term is already on the list.';
          } else {
            terms.add(term);
            message = `👮 Added banned term. ${terms.size} now on the list.`;
          }
          config.bannedTerms = [...terms];
          setPatrolConfig(ctx.guild.id, config);
          // The term itself is never echoed — the reply lands in a public channel
          // now (S54: no ephemerals on the text path), so repeating it would post
          // the very word the admin is trying to suppress.
          await ctx.reply(message);
        },
      },
      {
        // S106: was `!patrol wizard`.
        name: 'wizard',
        aliases: ['setup'],
        description: 'Guided setup for the patrol automod — pick rules, add terms, review, done (admin).',
        permission: PermissionFlagsBits.ManageGuild,
        args: [],
        async run(ctx) {

          const config = getPatrolConfig(ctx.guild.id);
          // The draft starts from what is configured today, so re-running the
          // wizard edits the live setup instead of starting from scratch.
          startWizardDraft(ctx.guild.id, ctx.user.id, {
            rules: { ...config.rules },
            bannedTerms: [...config.bannedTerms],
          });
          await ctx.reply(renderOverview(config));
        },
      },
    ],
  },
};
