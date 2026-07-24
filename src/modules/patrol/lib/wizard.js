// Pure patrol-wizard logic — no discord.js. The interactive rendering lives
// in wizard-ui.js; everything testable (term parsing, draft summaries, the
// RAM draft-state rules) sits here.

export const WIZARD_TTL_MS = 10 * 60_000; // an abandoned wizard evaporates

export const RULE_CHOICES = [
  {
    key: 'bannedTerms',
    label: 'Banned terms',
    emoji: '🤬',
    description: 'Evasion-aware word filter (catches "b@d-w0rd") — you provide the list',
  },
  {
    key: 'invites',
    label: 'Invite links',
    emoji: '🔗',
    description: 'Blocks discord.gg invite spam',
  },
  {
    key: 'spam',
    label: 'Spam',
    emoji: '📢',
    description: 'Mention floods (6+) and repeated-character walls',
  },
];

/**
 * Parse the terms modal input: split on commas/semicolons/newlines, trim,
 * drop empties, dedupe case-insensitively, clamp term length and list size.
 */
export function parseTermsInput(text, { maxTerms = 100, maxLength = 64 } = {}) {
  const seen = new Set();
  const terms = [];
  for (const raw of String(text ?? '').split(/[\n,;]+/)) {
    const term = raw.trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    terms.push(term.slice(0, maxLength));
    if (terms.length >= maxTerms) break;
  }
  return terms;
}

/** Review-step lines for a draft: rule toggles + a banned-terms preview. */
export function summarizeDraft(draft) {
  const lines = RULE_CHOICES.map(
    (c) => `${draft.rules[c.key] ? '✅' : '❌'} ${c.emoji} **${c.label}** — ${c.description}`,
  );
  if (draft.rules.bannedTerms) {
    const preview = draft.bannedTerms.slice(0, 10).join(', ');
    lines.push(
      draft.bannedTerms.length
        ? `📝 **${draft.bannedTerms.length} banned term(s):** ${preview}${draft.bannedTerms.length > 10 ? ', …' : ''}`
        : '📝 **No banned terms yet** — the word filter stays dormant until you add terms.',
    );
  }
  return lines;
}

/** Apply a rules-select interaction (array of chosen keys) to a draft. */
export function applyRuleSelection(draft, selectedKeys) {
  const chosen = new Set(selectedKeys);
  return {
    ...draft,
    rules: Object.fromEntries(RULE_CHOICES.map((c) => [c.key, chosen.has(c.key)])),
  };
}
