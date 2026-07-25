// Pure rules-list logic (S97 = M18, owner request: "makkelijke manier om
// regels te maken, de bot maakt een mooi overzichtelijke post"). No discord.js
// imports — list editing and rendering are both testable without a gateway.
//
// Numbering is POSITIONAL, not stored: rule 2 is whatever sits second. That is
// what a rules list means — 1..N contiguous, no gaps — and it makes remove and
// move renumber for free. The consequence to know: removing rule 2 shifts
// every rule below it up one, so the commands always echo the resulting list.

/** Discord's embed description cap is 4096; leave room for the header/footer. */
export const DESCRIPTION_BUDGET = 3800;
export const MAX_RULES = 100;
export const MAX_RULE_LENGTH = 500;

/** Normalize whatever is in storage into a clean array of rule strings. */
export function normalizeRules(stored) {
  if (!Array.isArray(stored)) return [];
  return stored
    .map((rule) => (typeof rule === 'string' ? rule : rule?.text))
    .filter((text) => typeof text === 'string' && text.trim().length > 0)
    .map((text) => text.trim())
    .slice(0, MAX_RULES);
}

/**
 * Every mutation returns `{ ok, rules, message }` rather than throwing, so the
 * command layer is a straight "apply, then say what happened".
 */
const fail = (rules, message) => ({ ok: false, rules, message });
const done = (rules, message) => ({ ok: true, rules, message });

export function addRule(rules, text) {
  const clean = String(text ?? '').trim();
  if (!clean) return fail(rules, 'A rule needs some text.');
  if (clean.length > MAX_RULE_LENGTH) {
    return fail(rules, `That rule is ${clean.length} characters; the limit is ${MAX_RULE_LENGTH}.`);
  }
  if (rules.length >= MAX_RULES) {
    return fail(rules, `The rulebook is full (${MAX_RULES} rules). Remove one first.`);
  }
  const next = [...rules, clean];
  return done(next, `📜 Added as rule **${next.length}**.`);
}

/** `number` is 1-based, as the published post shows it. */
export function editRule(rules, number, text) {
  if (!isValidNumber(rules, number)) return fail(rules, outOfRange(rules, number));
  const clean = String(text ?? '').trim();
  if (!clean) return fail(rules, 'A rule needs some text.');
  if (clean.length > MAX_RULE_LENGTH) {
    return fail(rules, `That rule is ${clean.length} characters; the limit is ${MAX_RULE_LENGTH}.`);
  }
  const next = [...rules];
  next[number - 1] = clean;
  return done(next, `📜 Rule **${number}** rewritten.`);
}

export function removeRule(rules, number) {
  if (!isValidNumber(rules, number)) return fail(rules, outOfRange(rules, number));
  const next = rules.filter((_, i) => i !== number - 1);
  const tail =
    number <= next.length
      ? ` Rules ${number}–${next.length} moved up one.`
      : '';
  return done(next, `📜 Rule **${number}** removed — ${next.length} left.${tail}`);
}

/** Move a rule to a new position; both numbers are 1-based. */
export function moveRule(rules, from, to) {
  if (!isValidNumber(rules, from)) return fail(rules, outOfRange(rules, from));
  if (!isValidNumber(rules, to)) return fail(rules, outOfRange(rules, to));
  if (from === to) return fail(rules, `Rule **${from}** is already there.`);
  const next = [...rules];
  const [moved] = next.splice(from - 1, 1);
  next.splice(to - 1, 0, moved);
  return done(next, `📜 Rule **${from}** is now rule **${to}**.`);
}

export function clearRules(rules) {
  if (rules.length === 0) return fail(rules, 'There are no rules to clear.');
  return done([], `📜 All ${rules.length} rules erased.`);
}

const isValidNumber = (rules, n) => Number.isInteger(n) && n >= 1 && n <= rules.length;
const outOfRange = (rules, n) =>
  rules.length === 0
    ? 'There are no rules yet.'
    : `There is no rule **${n}** — the rulebook runs 1–${rules.length}.`;

/**
 * Split the rendered rules into embed-sized pages, breaking only BETWEEN
 * rules so a rule is never cut in half. The header opens page one and the
 * footer closes the last page.
 *
 * @returns {Array<{ description: string, first: boolean, last: boolean }>}
 */
export function paginateRules(rules, { header = '', footer = '', budget = DESCRIPTION_BUDGET } = {}) {
  const lines = rules.map((text, i) => `**${i + 1}.** ${text}`);
  if (lines.length === 0) {
    const body = [header, '_No rules have been written yet._', footer].filter(Boolean).join('\n\n');
    return [{ description: body, first: true, last: true }];
  }

  const pages = [];
  let current = [];
  let length = 0;
  const headerCost = header ? header.length + 2 : 0;

  for (const line of lines) {
    const cost = line.length + 1;
    const overhead = pages.length === 0 && current.length === 0 ? headerCost : 0;
    if (current.length > 0 && length + cost > budget) {
      pages.push(current);
      current = [];
      length = 0;
    }
    current.push(line);
    length += cost + overhead;
  }
  if (current.length > 0) pages.push(current);

  return pages.map((page, index) => {
    const first = index === 0;
    const last = index === pages.length - 1;
    const body = [first && header ? header : null, page.join('\n'), last && footer ? footer : null]
      .filter(Boolean)
      .join('\n\n');
    return { description: body, first, last };
  });
}
