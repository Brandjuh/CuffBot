// The guided patrol setup (S47), brought back to life in S95 (M17.3 slice C).
//
// It has been DEAD since S68: the body checked `interaction.isTextCommand` and
// bailed with "being rebuilt for text-only mode", and S68 made every
// invocation a text command — so the wizard has answered nothing but that
// notice ever since, for eleven months of sessions.
//
// Nothing about it actually needed a slash command. Buttons, selects and
// modals attach to a *message*, and the module's own InteractionCreate pump
// (`events/wizard.js`) handles their component interactions either way. So
// the wizard now posts its overview as a normal channel message and works.
//
// One consequence of a public message: anyone can see the buttons. The draft
// is keyed by (guild, user) so a stranger's click already found no draft, but
// the pump now also re-checks Manage Server on every component — a visible
// refusal beats a confusing "expired".
import { PermissionFlagsBits } from 'discord.js';
import { getPatrolConfig, startWizardDraft } from '../service.js';
import { renderOverview } from '../wizard-ui.js';

export default {
  command: {
    name: 'patrol-wizard',
    description:
      'Guided setup for the patrol automod — pick rules, add terms, review, done (admin).',
    emoji: '👮',
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
};
