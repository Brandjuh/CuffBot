// Detective (AI) service: the one pipeline both /ask and the mention-reply
// event go through. Owns the process-global rate limiter (owner spec: ONE
// budget for the whole server), the per-channel conversation memory, and the
// provider call. Pure rules live in lib/; this file only wires them together.
import { getGuildData, setGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { createLimiter, humanWait } from './lib/ratelimit.js';
import {
  LIMITS,
  PERSONA,
  buildMessages,
  normalizeQuestion,
  normalizeReply,
  pruneHistory,
} from './lib/prompt.js';
import { pickProvider } from './lib/providers.js';

export const AI_CONFIG_KEY = 'aiConfig';
export const DEFAULT_AI_CONFIG = { enabled: true };

export function getAiConfig(guildId) {
  return { ...DEFAULT_AI_CONFIG, ...getGuildData(guildId, AI_CONFIG_KEY, {}) };
}

export function setAiConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, AI_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, AI_CONFIG_KEY, stored);
  return { ...DEFAULT_AI_CONFIG, ...stored };
}

// ONE limiter for the whole process = the whole server (single-guild bot).
// Exported for the status display; tests build their own via lib/.
export const limiter = createLimiter();

// Per-channel short-term memory: channelId → [{role, content, at}].
const histories = new Map();

export function rememberExchange(channelId, askerName, question, reply, now) {
  const history = pruneHistory(histories.get(channelId), now);
  history.push({ role: 'user', content: `${askerName}: ${question}`, at: now });
  history.push({ role: 'assistant', content: reply, at: now });
  histories.set(channelId, pruneHistory(history, now));
}

/** Test seam / hygiene: drop all remembered conversations. */
export function forgetAllConversations() {
  histories.clear();
}

/**
 * One AI turn: availability checks → global rate limit → provider call.
 * Never throws: every failure mode returns { ok:false, message } with a
 * user-ready, in-theme explanation.
 * @returns {Promise<{ok:true, reply:string} | {ok:false, message:string}>}
 */
export async function askDetective({ guildId, channelId, askerName, question, now = Date.now(), env = process.env, fetchImpl = fetch }) {
  if (!getAiConfig(guildId).enabled) {
    return { ok: false, message: '🕵️ The detective is off duty — an admin can bring them back with `/ai-config enabled:True`.' };
  }
  const provider = pickProvider(env);
  if (!provider) {
    return {
      ok: false,
      message:
        '🕵️ No AI provider is configured. The owner must add `GROQ_API_KEY` or `GEMINI_API_KEY` to `.env` on the Pi and restart (see `docs/modules/detective.md`).',
    };
  }
  const clean = normalizeQuestion(question);
  if (!clean) {
    return { ok: false, message: '🕵️ Ask me something, officer — e.g. `/ask question: who invented the traffic light?`' };
  }

  // The GLOBAL limit (owner spec): 1 message per 7 s AND 62 per hour, shared
  // by everyone together — checked before any tokens are spent.
  const slot = limiter.take(now);
  if (!slot.ok) {
    const wait = humanWait(slot.retryAfterMs);
    return {
      ok: false,
      message:
        slot.reason === 'cooldown'
          ? `📻 The radio is busy — one question per 7 seconds for the whole precinct. Try again in ${wait}.`
          : `📻 The precinct's hourly detective budget (62 questions) is spent. New slot in ~${wait}.`,
    };
  }

  const messages = buildMessages(histories.get(channelId), askerName, clean, now);
  try {
    const raw = await provider.complete({ system: PERSONA, messages, env, fetchImpl });
    const reply = normalizeReply(raw);
    rememberExchange(channelId, askerName, clean, reply, now);
    return { ok: true, reply };
  } catch (error) {
    logger.warn(`Detective: ${provider.name} call failed:`, error);
    return {
      ok: false,
      message: '🕵️ The detective’s phone line dropped (provider error). Try again in a bit — if it keeps failing, the owner should check the API key and `journalctl -u cuffbot`.',
    };
  }
}

/** Status line data for /ai-config. */
export function detectiveStatus(guildId, now = Date.now(), env = process.env) {
  const provider = pickProvider(env);
  const use = limiter.usage(now);
  return {
    enabled: getAiConfig(guildId).enabled,
    provider: provider?.name ?? null,
    model: provider?.model(env) ?? null,
    usedThisHour: use.usedThisHour,
    maxPerHour: use.maxPerHour,
    historyLimits: LIMITS,
  };
}
