// Pure prompt assembly for the detective (AI) module — no discord.js, no IO.
// Builds the provider-neutral message list from the persona, a short rolling
// conversation history, and the new question. All limits live here so they are
// unit-tested, not scattered through handlers.

export const LIMITS = {
  maxQuestionChars: 1_000, // longer questions are cut (with an ellipsis)
  maxHistoryEntries: 8, // last N exchanges kept per channel
  historyTtlMs: 30 * 60_000, // a stale conversation is forgotten
  maxReplyChars: 1_900, // Discord message cap is 2000; leave margin
  // Keep request INPUT small enough that a full-rate stream of questions fits
  // Groq's 6K tokens/minute (S33, owner dashboard): history is trimmed
  // oldest-first past this estimated-token budget.
  maxHistoryTokens: 1_200,
  maxOutputTokens: 400, // must match the providers' max_tokens setting
};

/**
 * Rough token estimate (≈4 chars/token — the standard heuristic). Used for
 * budget math only; deliberately conservative rather than exact.
 */
export function estimateTokens(text) {
  return Math.ceil(String(text ?? '').length / 4);
}

/** Estimated total tokens one request will consume (input + reserved output). */
export function estimateRequestTokens(system, messages, limits = LIMITS) {
  const input = estimateTokens(system) + messages.reduce((n, m) => n + estimateTokens(m.content), 0);
  return input + limits.maxOutputTokens;
}

export const PERSONA = [
  'You are CuffBot, the precinct detective of a police-themed Discord server called the precinct.',
  'Stay in light police flavor (detective, dispatch, precinct) without overdoing it.',
  'Answer in the language the user writes in (often Dutch or English).',
  'Be helpful, factual, and concise: a few sentences, at most ~150 words, no markdown headers.',
  'Never invent facts about server members; if asked for personal data, advice on wrongdoing, or anything hateful, decline briefly and in character.',
  'You cannot moderate, run commands, or change server settings — if asked, point to the relevant /command instead.',
].join(' ');

/** Trim a question to the limit, marking the cut. Returns null for empties. */
export function normalizeQuestion(text) {
  const clean = String(text ?? '').trim();
  if (clean.length === 0) return null;
  if (clean.length <= LIMITS.maxQuestionChars) return clean;
  return `${clean.slice(0, LIMITS.maxQuestionChars - 1)}…`;
}

/**
 * Prune a history array (mutating nothing): drop entries older than the TTL,
 * keep only the newest maxHistoryEntries.
 * @param {Array<{role:string, content:string, at:number}>} history
 */
export function pruneHistory(history, now, limits = LIMITS) {
  return (history ?? [])
    .filter((h) => now - h.at < limits.historyTtlMs)
    .slice(-limits.maxHistoryEntries);
}

/**
 * Build the provider-neutral message list. The asker's display name is folded
 * into the user content so multi-user conversations stay attributable.
 * @returns {Array<{role:'user'|'assistant', content:string}>}
 */
export function buildMessages(history, askerName, question, now, limits = LIMITS) {
  let messages = pruneHistory(history, now, limits).map((h) => ({
    role: h.role,
    content: h.content,
  }));
  // Token-aware trim (S33): drop the OLDEST exchanges until the history fits
  // the input budget — long answers would otherwise blow the provider's
  // tokens-per-minute limit while adding little context.
  while (
    messages.length > 0 &&
    messages.reduce((n, m) => n + estimateTokens(m.content), 0) > limits.maxHistoryTokens
  ) {
    messages = messages.slice(1);
  }
  messages.push({ role: 'user', content: `${askerName}: ${question}` });
  return messages;
}

/** Clamp a model reply for Discord; strip stray @everyone/@here as belt+braces. */
export function normalizeReply(text, limits = LIMITS) {
  let out = String(text ?? '').trim();
  out = out.replace(/@(everyone|here)/g, '@​$1');
  if (out.length === 0) return '…the detective stares silently at the case board. (Empty reply — try again.)';
  if (out.length > limits.maxReplyChars) out = `${out.slice(0, limits.maxReplyChars - 1)}…`;
  return out;
}
