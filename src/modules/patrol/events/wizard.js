// The patrol-wizard's interaction pump: one module-owned InteractionCreate
// handler (trivia pattern) that only touches "patrol-wizard:" customIds. The
// draft lives in RAM (service) until Save.
//
// S95: the wizard message is a normal channel message now (S68 left the
// command dead because it refused to run as a text command), so the buttons
// are visible to everyone in the channel. Two gates instead of the old
// ephemerality: Manage Server is re-checked on every component, and the draft
// is keyed by (guild, user) so one admin cannot steer another's wizard.
import { Events, PermissionFlagsBits } from 'discord.js';
import { logger } from '../../../core/logger.js';
import { applyRuleSelection, parseTermsInput } from '../lib/wizard.js';
import {
  clearWizardDraft,
  getPatrolConfig,
  getWizardDraft,
  setPatrolConfig,
  updateWizardDraft,
} from '../service.js';
import {
  buildTermsModal,
  renderCancelled,
  renderDone,
  renderExpired,
  renderReview,
  renderRules,
} from '../wizard-ui.js';

const PREFIX = 'patrol-wizard:';

export default {
  name: Events.InteractionCreate,
  async execute(interaction) {
    const isComponent = interaction.isButton?.() || interaction.isStringSelectMenu?.();
    const isModal = interaction.isModalSubmit?.();
    if (!isComponent && !isModal) return;
    const customId = interaction.customId ?? '';
    if (!customId.startsWith(PREFIX)) return;

    try {
      const action = customId.slice(PREFIX.length);
      const guild = interaction.guild;
      if (!guild) return;

      // S95: a public message means anyone can press. Refuse visibly rather
      // than letting a non-admin fall through to the "expired" branch.
      const perms =
        interaction.channel?.permissionsFor?.(interaction.member) ?? interaction.member?.permissions;
      if (!perms?.has?.(PermissionFlagsBits.ManageGuild)) {
        await interaction.reply({
          content: '🚫 You need **Manage Server** to use the patrol wizard.',
          flags: 64,
        });
        return;
      }

      const respond = async (payload) => {
        // Modal submits from an ephemeral message can update it too.
        if (isModal && !interaction.isFromMessage?.()) {
          await interaction.reply({ ...payload, flags: 64 });
        } else {
          await interaction.update(payload);
        }
      };

      if (action === 'cancel') {
        clearWizardDraft(guild.id, interaction.user.id);
        await respond(renderCancelled());
        return;
      }

      const draft = getWizardDraft(guild.id, interaction.user.id);
      if (!draft) {
        await respond(renderExpired());
        return;
      }

      switch (action) {
        case 'start':
        case 'back':
          await respond(renderRules(draft));
          return;
        case 'pick': {
          const next = updateWizardDraft(
            guild.id,
            interaction.user.id,
            applyRuleSelection(draft, interaction.values ?? []),
          );
          await respond(renderRules(next));
          return;
        }
        case 'next':
          await respond(renderReview(draft));
          return;
        case 'edit-terms':
          // showModal IS this interaction's response — no update alongside it.
          await interaction.showModal(buildTermsModal(draft));
          return;
        case 'terms-modal': {
          const raw = interaction.fields?.getTextInputValue?.('terms') ?? '';
          const next = updateWizardDraft(guild.id, interaction.user.id, {
            ...draft,
            bannedTerms: parseTermsInput(raw),
          });
          await respond(renderReview(next));
          return;
        }
        case 'save':
        case 'enable': {
          const config = {
            ...getPatrolConfig(guild.id),
            enabled: action === 'enable',
            rules: { ...draft.rules },
            bannedTerms: [...draft.bannedTerms],
          };
          setPatrolConfig(guild.id, config);
          clearWizardDraft(guild.id, interaction.user.id);
          await respond(renderDone(config));
          return;
        }
        default:
          logger.warn(`Patrol wizard: unknown action "${action}"`);
      }
    } catch (error) {
      logger.warn('Patrol wizard interaction failed:', error);
    }
  },
};
