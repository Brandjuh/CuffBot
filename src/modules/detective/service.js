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
  estimateRequestTokens,
  normalizeQuestion,
  normalizeReply,
  pruneHistory,
} from './lib/prompt.js';
import { dailyLimitFor, pickProvider } from './lib/providers.js';
import { enqueueQuestion, shouldQueue, waitStory } from './lib/queue.js';

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

// The desk pile: questions parked by the rate limiter, answered automatically
// by the flusher once a slot frees up. RAM-only — a restart clears the pile
// (documented), which only ever means someone re-asks.
let pendingQueue = [];
let storyCounter = 0;

export function pendingCount() {
  return pendingQueue.length;
}

/** Test seam. */
export function clearQueue() {
  pendingQueue = [];
}

/** Provider call + memory, WITHOUT limiter checks — callers hold a slot. */
async function completeQuestion({ guildId, channelId, askerName, question, now, env, fetchImpl }) {
  const provider = pickProvider(env);
  if (!provider) {
    return { ok: false, message: '🕵️ No AI provider is configured anymore — the owner should check `.env`.' };
  }
  const messages = buildMessages(histories.get(channelId), askerName, question, now);
  try {
    const raw = await provider.complete({ system: PERSONA, messages, env, fetchImpl });
    const reply = normalizeReply(raw);
    rememberExchange(channelId, askerName, question, reply, now);
    return { ok: true, reply };
  } catch (error) {
    logger.warn(`Detective: ${provider.name} call failed:`, error);
    if (/HTTP 429/.test(String(error?.message ?? ''))) {
      return {
        ok: false,
        message: `📻 ${provider.name}'s free-tier quota is tapped out for now (their side, HTTP 429). It resets automatically — try again later.`,
      };
    }
    return {
      ok: false,
      message: '🕵️ The detective’s phone line dropped (provider error). Try again in a bit — if it keeps failing, the owner should check the API key and `journalctl -u cuffbot`.',
    };
  }
}

/**
 * One AI turn: availability checks → global rate limit → provider call.
 * Never throws: every failure mode returns { ok:false, message } with a
 * user-ready, in-theme explanation.
 * @returns {Promise<{ok:true, reply:string} | {ok:false, message:string}>}
 */
export async function askDetective({ guildId, channelId, askerName, question, userId = null, now = Date.now(), env = process.env, fetchImpl = fetch }) {
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
  // by everyone together — plus the active provider's free-tier caps:
  // requests/day AND (S33) estimated tokens/minute + tokens/day. All checked
  // before any tokens are spent.
  const maxPerDay = dailyLimitFor(provider, env);
  const plannedMessages = buildMessages(histories.get(channelId), askerName, clean, now);
  const tokens = estimateRequestTokens(PERSONA, plannedMessages);
  const slot = limiter.take(now, { maxPerDay, tokens, tpm: provider.tpm ?? null, tpd: provider.tpd ?? null });
  if (!slot.ok) {
    const wait = humanWait(slot.retryAfterMs);
    // Owner request (S29): don't make people retype — park the question on
    // the desk pile and answer automatically when a slot frees up. Daily
    // refusals are NOT parked (hours-long waits answer into a dead room).
    if (shouldQueue(slot.reason, slot.retryAfterMs)) {
      const parked = enqueueQuestion(pendingQueue, {
        guildId,
        channelId,
        userId,
        askerName,
        question: clean,
        queuedAt: now,
      });
      if (parked.status !== 'full') {
        pendingQueue = parked.queue;
        storyCounter += 1;
        const note = parked.status === 'replaced' ? '\n_(This replaces your earlier parked question.)_' : '';
        return { ok: false, queued: true, message: `${waitStory(storyCounter, parked.position, wait)}${note}` };
      }
      return {
        ok: false,
        message: `🗂️ The desk pile is FULL (${pendingQueue.length} cases waiting) — the precinct is popular today. Try again in ~${wait}.`,
      };
    }
    const refusals = {
      cooldown: `📻 The radio is busy — one question per 7 seconds for the whole precinct. Try again in ${wait}.`,
      hourly: `📻 The precinct's hourly detective budget (62 questions) is spent. New slot in ~${wait}.`,
      daily: `📻 The precinct's DAILY detective budget (${maxPerDay} questions on the free ${provider.name} tier) is spent — the desk pile can't bridge a wait that long. Come back tomorrow, officer.`,
      'tokens-minute': `📻 The radio channel is saturated (the free ${provider.name} tier's token budget this minute). Try again in ~${wait}.`,
      'tokens-day': `📻 Today's token budget on the free ${provider.name} tier is spent — the detective is out of ink. Come back tomorrow, officer.`,
    };
    return { ok: false, message: refusals[slot.reason] ?? refusals.hourly };
  }

  return completeQuestion({ guildId, channelId, askerName, question: clean, now, env, fetchImpl });
}

/**
 * Answer parked questions as budget frees up (called by the queue-flush
 * event every ~10 s; injectable for tests). Answers land in the original
 * channel, mentioning the asker. One question per tick keeps the cooldown
 * honest — the pile drains at the same pace members would.
 * @returns {Promise<number>} answers delivered this tick
 */
export async function flushQueue(client, { now = Date.now(), env = process.env, fetchImpl = fetch } = {}) {
  if (pendingQueue.length === 0) return 0;
  const provider = pickProvider(env);
  if (!provider) return 0;
  const item = pendingQueue[0];
  if (!getAiConfig(item.guildId).enabled) {
    pendingQueue = pendingQueue.slice(1); // parked before the off-switch — drop silently
    return 0;
  }
  const flushMessages = buildMessages(histories.get(item.channelId), item.askerName, item.question, now);
  const slot = limiter.take(now, {
    maxPerDay: dailyLimitFor(provider, env),
    tokens: estimateRequestTokens(PERSONA, flushMessages),
    tpm: provider.tpm ?? null,
    tpd: provider.tpd ?? null,
  });
  if (!slot.ok) return 0; // still throttled — next tick tries again
  pendingQueue = pendingQueue.slice(1);

  const result = await completeQuestion({ ...item, now, env, fetchImpl });
  try {
    let channel = client.channels?.cache?.get(item.channelId) ?? null;
    if (!channel) channel = await client.channels?.fetch?.(item.channelId).catch(() => null);
    if (!channel?.send) return 0;
    const mention = item.userId ? `<@${item.userId}> ` : '';
    await channel.send({
      content: result.ok
        ? `🕵️ ${mention}Case reopened — you asked: “${item.question.slice(0, 150)}${item.question.length > 150 ? '…' : ''}”\n${result.reply}`
        : `${mention}${result.message}`,
      allowedMentions: { users: item.userId ? [item.userId] : [] },
    });
    return result.ok ? 1 : 0;
  } catch (error) {
    logger.warn('Detective: queue flush delivery failed:', error);
    return 0;
  }
}

/** Status line data for /ai-config. */
export function detectiveStatus(guildId, now = Date.now(), env = process.env) {
  const provider = pickProvider(env);
  const use = limiter.usage(now, { maxPerDay: dailyLimitFor(provider, env) });
  return {
    enabled: getAiConfig(guildId).enabled,
    provider: provider?.name ?? null,
    model: provider?.model(env) ?? null,
    usedThisHour: use.usedThisHour,
    maxPerHour: use.maxPerHour,
    usedToday: use.usedToday,
    maxPerDay: use.maxPerDay,
    tokensThisMinute: use.tokensThisMinute,
    tokensToday: use.tokensToday,
    tpm: provider?.tpm ?? null,
    tpd: provider?.tpd ?? null,
    historyLimits: LIMITS,
  };
}
