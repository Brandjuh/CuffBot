// Pure message screening — no discord.js imports. Given a message's text and a
// guild's patrol config, return the violations found. All the tricky matching
// lives here so it can be unit-tested exhaustively without a live gateway.

const LEET = { 0: 'o', 1: 'i', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', '@': 'a', $: 's', '!': 'i' };

/**
 * Normalize text for evasion-aware matching: lowercase, strip diacritics,
 * fold common leetspeak, and drop everything that isn't a letter or digit.
 * So "B̲a̲d̲-W̲0̲r̲d̲", "b a d w o r d", and "b@dw0rd" all collapse to "badword".
 * This is deliberately aggressive; the trade-off (substring false positives) is
 * documented in the patrol manual, and moderators are exempt from screening.
 */
export function normalizeForMatch(text) {
  return (text ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[0134578@$!]/g, (c) => LEET[c] ?? c)
    .replace(/[^a-z0-9]/g, '');
}

/** Banned terms present in the content (normalized), as the original terms. */
export function detectBannedTerms(content, terms = []) {
  const norm = normalizeForMatch(content);
  return terms.filter((t) => {
    const nt = normalizeForMatch(t);
    return nt.length > 0 && norm.includes(nt);
  });
}

const INVITE_RE = /(?:discord(?:app)?\.com\/invite|discord\.(?:gg|io|me|li)|dsc\.gg|discord\.gg)\/[a-z0-9-]+/i;

/** True if the content contains a Discord invite link (spacing-tolerant). */
export function detectInvites(content) {
  const raw = content ?? '';
  return INVITE_RE.test(raw) || INVITE_RE.test(raw.replace(/\s+/g, ''));
}

/**
 * Spam heuristic — returns a short reason string or null. Kept simple and
 * testable: a flood of mentions, or the same character run 10+ times.
 */
export function detectSpam(content, { maxMentions = 5, maxRepeat = 10 } = {}) {
  const text = content ?? '';
  const mentions = (text.match(/<@[!&]?\d+>/g) ?? []).length;
  if (mentions > maxMentions) return `mention flood (${mentions})`;
  if (new RegExp(`(.)\\1{${maxRepeat - 1},}`).test(text)) return 'repeated characters';
  return null;
}

export const DEFAULT_PATROL_CONFIG = {
  enabled: false,
  rules: { bannedTerms: true, invites: true, spam: true },
  bannedTerms: [],
};

/**
 * Screen a message against the config.
 * @returns {Array<{type:string, detail?:any}>} violations (empty if clean)
 */
export function screenMessage(content, config = DEFAULT_PATROL_CONFIG) {
  const rules = config.rules ?? DEFAULT_PATROL_CONFIG.rules;
  const violations = [];
  if (rules.bannedTerms && (config.bannedTerms?.length ?? 0) > 0) {
    const hits = detectBannedTerms(content, config.bannedTerms);
    if (hits.length > 0) violations.push({ type: 'banned-term', detail: hits });
  }
  if (rules.invites && detectInvites(content)) {
    violations.push({ type: 'invite-link' });
  }
  if (rules.spam) {
    const spam = detectSpam(content);
    if (spam) violations.push({ type: 'spam', detail: spam });
  }
  return violations;
}

/** One-line human summary of violations, for logs and the rap sheet. */
export function summarizeViolations(violations) {
  return violations
    .map((v) => {
      if (v.type === 'banned-term') return `banned term (${v.detail.join(', ')})`;
      if (v.type === 'invite-link') return 'invite link';
      if (v.type === 'spam') return `spam: ${v.detail}`;
      return v.type;
    })
    .join('; ');
}
