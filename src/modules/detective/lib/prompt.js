// Pure prompt assembly for the detective (AI) module — no discord.js, no IO.
// Builds the provider-neutral message list from the persona, a short rolling
// conversation history, and the new question. All limits live here so they are
// unit-tested, not scattered through handlers.

export const LIMITS = {
  maxQuestionChars: 1_000, // longer questions are cut (with an ellipsis)
  maxHistoryEntries: 8, // last N exchanges kept per channel
  historyTtlMs: 30 * 60_000, // a stale conversation is forgotten
  maxReplyChars: 1_900, // Discord message cap is 2000; leave margin
};

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
  const messages = pruneHistory(history, now, limits).map((h) => ({
    role: h.role,
    content: h.content,
  }));
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
