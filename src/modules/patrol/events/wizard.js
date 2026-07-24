// The patrol-wizard's interaction pump: one module-owned InteractionCreate
// handler (trivia pattern) that only touches "patrol-wizard:" customIds.
// Wizard messages are ephemeral, so only the admin who started it can press
// anything; the draft lives in RAM (service) until Save.
import { Events } from 'discord.js';
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
