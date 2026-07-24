// Patrol-wizard rendering: every step as a full ephemeral message payload
// ({embeds, components}). Pure step logic lives in lib/wizard.js; this file
// only builds discord.js component trees around it.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { RULE_CHOICES, summarizeDraft } from './lib/wizard.js';

const COLOR = 0x2c3e50;
const embed = (title, description) =>
  new EmbedBuilder().setColor(COLOR).setTitle(title).setDescription(description);
const button = (id, label, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(`patrol-wizard:${id}`).setLabel(label).setStyle(style);
const cancelRow = (...buttons) =>
  new ActionRowBuilder().addComponents(...buttons, button('cancel', 'Cancel', ButtonStyle.Danger));

/** Step 1 — what patrol is, current state, [Start]. */
export function renderOverview(config) {
  const termCount = config.bannedTerms?.length ?? 0;
  return {
    embeds: [
      embed(
        '👮 Patrol Setup — Step 1 of 3',
        [
          'Patrol is the precinct’s automod: it screens every message and, on a hit, **deletes it, DMs the member, files a rap-sheet record, and logs to the evidence locker**. Moderators are always exempt.',
          '',
          '**It can watch for three things:**',
          ...RULE_CHOICES.map((c) => `${c.emoji} **${c.label}** — ${c.description}`),
          '',
          `**Right now:** patrol is **${config.enabled ? 'ON' : 'OFF'}** · ${termCount} banned term(s) on file.`,
          '',
          'This wizard walks you through it in 3 short steps. Nothing is saved until the last step.',
        ].join('\n'),
      ),
    ],
    components: [cancelRow(button('start', 'Start setup', ButtonStyle.Primary))],
  };
}

/** Step 2 — pick rule categories with a multi-select. */
export function renderRules(draft) {
  const select = new StringSelectMenuBuilder()
    .setCustomId('patrol-wizard:pick')
    .setPlaceholder('Choose which rules patrol enforces…')
    .setMinValues(0)
    .setMaxValues(RULE_CHOICES.length)
    .addOptions(
      RULE_CHOICES.map((c) => ({
        label: c.label,
        value: c.key,
        description: c.description.slice(0, 100),
        emoji: c.emoji,
        default: Boolean(draft.rules[c.key]),
      })),
    );
  return {
    embeds: [
      embed(
        '👮 Patrol Setup — Step 2 of 3: choose the rules',
        [
          'Select the rules to enforce (all three is the usual choice), then hit **Next**.',
          '',
          ...RULE_CHOICES.map(
            (c) => `${draft.rules[c.key] ? '✅' : '❌'} ${c.emoji} **${c.label}** — ${c.description}`,
          ),
        ].join('\n'),
      ),
    ],
    components: [
      new ActionRowBuilder().addComponents(select),
      cancelRow(button('next', 'Next →', ButtonStyle.Primary)),
    ],
  };
}

/** Step 3 — review + save. */
export function renderReview(draft) {
  const buttons = [];
  if (draft.rules.bannedTerms) buttons.push(button('edit-terms', '✏️ Edit banned terms'));
  buttons.push(button('back', '↩ Rules'));
  buttons.push(button('enable', '🚨 Save & turn patrol ON', ButtonStyle.Success));
  buttons.push(button('save', '💾 Save, keep OFF'));
  return {
    embeds: [
      embed(
        '👮 Patrol Setup — Step 3 of 3: review',
        [
          ...summarizeDraft(draft),
          '',
          'On a violation: message deleted → member DM’d → rap-sheet record → evidence-locker log. Moderators are exempt.',
          '**Save & turn ON** starts enforcement immediately; **Save, keep OFF** stores everything for later (`/patrol on`).',
        ].join('\n'),
      ),
    ],
    components: [cancelRow(...buttons)],
  };
}

/** The banned-terms modal, prefilled with the draft's current list. */
export function buildTermsModal(draft) {
  const input = new TextInputBuilder()
    .setCustomId('terms')
    .setLabel('Banned terms — comma or newline separated')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(false)
    .setPlaceholder('badword, another term, one-per-line works too')
    .setMaxLength(3_000);
  const current = (draft.bannedTerms ?? []).join(', ');
  if (current) input.setValue(current.slice(0, 3_000));
  return new ModalBuilder()
    .setCustomId('patrol-wizard:terms-modal')
    .setTitle('Patrol — banned terms')
    .addComponents(new ActionRowBuilder().addComponents(input));
}

/** Final confirmation after saving. */
export function renderDone(config) {
  const termCount = config.bannedTerms?.length ?? 0;
  return {
    embeds: [
      embed(
        config.enabled ? '🚨 Patrol is ON DUTY' : '💾 Patrol config saved (still off)',
        [
          `Rules: ${RULE_CHOICES.filter((c) => config.rules[c.key])
            .map((c) => `${c.emoji} ${c.label}`)
            .join(' · ') || '_none_'} · ${termCount} banned term(s).`,
          '',
          config.enabled
            ? 'Test it: post a banned term from a NON-moderator account — the message should vanish within a second.'
            : 'Turn it on any time with `/patrol on` (or run this wizard again).',
          'Adjust later: `/patrol`, `/patrol-rule`, `/patrol-term` — or simply re-run `/patrol-wizard`.',
        ].join('\n'),
      ),
    ],
    components: [],
  };
}

/** Shown when a wizard button is pressed after the draft expired. */
export function renderExpired() {
  return {
    embeds: [
      embed('⏳ Wizard expired', 'This setup session timed out (10 min). Run `/patrol-wizard` again — nothing was saved.'),
    ],
    components: [],
  };
}

export function renderCancelled() {
  return {
    embeds: [embed('👮 Wizard closed', 'Nothing was saved. Run `/patrol-wizard` any time.')],
    components: [],
  };
}
