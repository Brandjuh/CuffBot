// Chat-starter service: question bank, per-channel activity tracking (RAM),
// and the posting action. Pure rules live in lib/starter.js. The optional AI
// path asks the detective's provider with its own tiny prompt, but draws from
// the SAME shared AI budget as /ask — free tiers cap requests per DAY (Gemini:
// 20), so an unmetered side channel would silently starve the members' budget.
// Any refusal or trouble falls back to the list.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { logger } from '../../core/logger.js';
import { DEFAULT_STARTER_CONFIG, pickQuestionIndex, rememberIndex, validateQuestions } from './lib/starter.js';
import { dailyLimitFor, pickProvider } from '../detective/lib/providers.js';
import { limiter as aiLimiter } from '../detective/service.js';

export const STARTER_CONFIG_KEY = 'chatStarterConfig';
export const STARTER_STATE_KEY = 'chatStarterState';

const bankPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'questions.json');

let bankCache = null;

/** The question bank (validated; an unreadable bank yields [] loudly). */
export function questionBank({ force = false } = {}) {
  if (bankCache && !force) return bankCache;
  try {
    const doc = JSON.parse(readFileSync(bankPath, 'utf8'));
    const check = validateQuestions(doc);
    if (!check.ok) throw new Error(check.error);
    bankCache = doc.questions;
  } catch (error) {
    logger.warn(`Chat-starter: question bank unusable (${error.message})`);
    bankCache = [];
  }
  return bankCache;
}

export function getStarterConfig(guildId) {
  return { ...DEFAULT_STARTER_CONFIG, ...getGuildData(guildId, STARTER_CONFIG_KEY, {}) };
}

export function setStarterConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, STARTER_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, STARTER_CONFIG_KEY, stored);
  return { ...DEFAULT_STARTER_CONFIG, ...stored };
}

// ── per-channel activity (RAM — a restart just starts a fresh idle window) ──

const activity = new Map(); // channelId → { lastActivityAt, humanSinceStarter }

export function noteActivity(channelId, { human, now = Date.now() } = { human: true }) {
  const entry = activity.get(channelId) ?? { lastActivityAt: now, humanSinceStarter: true };
  entry.lastActivityAt = now;
  if (human) entry.humanSinceStarter = true;
  activity.set(channelId, entry);
}

export function activityFor(channelId, now = Date.now()) {
  let entry = activity.get(channelId);
  if (!entry) {
    // First sight (e.g. right after boot): treat "now" as the last activity so
    // the idle window starts counting from boot, and allow the first starter.
    entry = { lastActivityAt: now, humanSinceStarter: true };
    activity.set(channelId, entry);
  }
  return entry;
}

export function markStarterPosted(channelId, now = Date.now()) {
  activity.set(channelId, { lastActivityAt: now, humanSinceStarter: false });
}

/** Test seam. */
export function resetActivity() {
  activity.clear();
}

/**
 * Seed the idle clock from the channel's real history (boot): read the most
 * recent message so "12 hours of silence" measures from the actual last
 * message, not from whenever the bot happened to restart. The bot's own
 * starter as last message keeps the never-monologue guard armed-off.
 */
export async function seedActivityFromHistory(guild, config, botUserId) {
  if (!config.channelId) return false;
  try {
    const channel = guild.channels.cache.get(config.channelId);
    const messages = await channel?.messages?.fetch?.({ limit: 1 });
    const last = messages?.first?.();
    if (!last) return false;
    activity.set(config.channelId, {
      lastActivityAt: last.createdTimestamp,
      humanSinceStarter: !(last.author?.id === botUserId),
    });
    return true;
  } catch (error) {
    logger.warn('Chat-starter: history seed failed (using boot time):', error);
    return false;
  }
}

/**
 * Post one starter to the configured channel RIGHT NOW (no idle/guard checks
 * — callers decide). Used by the sweep once its rules pass, and by the
 * /chat-starter-config test option.
 * @returns {Promise<boolean>} posted
 */
export async function postStarter(guild, config, now = Date.now()) {
  const channel = guild.channels.cache.get(config.channelId);
  if (!channel?.send) return false;
  const question = await nextQuestion(guild.id, config);
  if (!question) return false;
  try {
    await channel.send({ content: `💬 **Radio check, precinct!** ${question}`, allowedMentions: { parse: [] } });
    markStarterPosted(config.channelId, now);
    return true;
  } catch (error) {
    logger.warn('Chat-starter: post failed:', error);
    return false;
  }
}

// ── question selection + posting ─────────────────────────────────────────────

const AI_PROMPT =
  'Write exactly ONE short, open-ended conversation-starter question for a friendly police-themed ' +
  'Discord community. English, one sentence, no preamble, no quotes, no emoji spam. It must be a ' +
  'question anyone can answer regardless of background.';

/** A question from the AI provider, or null on any trouble (never throws). */
export async function aiQuestion(env = process.env, fetchImpl = fetch) {
  try {
    const provider = pickProvider(env);
    if (!provider) return null;
    // Same shared budget as /ask (cross-module seam): a refused slot means
    // the list question is used — members' questions outrank ice-breakers.
    // ~550 estimated tokens: the tiny prompt plus the reserved 400 output.
    const slot = aiLimiter.take(Date.now(), {
      maxPerDay: dailyLimitFor(provider, env),
      tokens: 550,
      tpm: provider.tpm ?? null,
      tpd: provider.tpd ?? null,
    });
    if (!slot.ok) return null;
    const raw = await provider.complete({
      system: 'You write single ice-breaker questions for community chats.',
      messages: [{ role: 'user', content: AI_PROMPT }],
      env,
      fetchImpl,
      timeoutMs: 15_000,
    });
    const line = String(raw ?? '').trim().split('\n')[0]?.trim();
    if (!line || line.length < 10 || line.length > 300) return null;
    return line;
  } catch (error) {
    logger.warn(`Chat-starter: AI question failed (${error.message}) — using the list`);
    return null;
  }
}

/**
 * Pick the question to post (AI when configured and available, list otherwise)
 * and remember the list index so back-to-back starters don't repeat.
 * @returns {Promise<string|null>} null when nothing is postable
 */
export async function nextQuestion(guildId, config, { env = process.env, fetchImpl = fetch, random = Math.random } = {}) {
  if (config.useAi) {
    const generated = await aiQuestion(env, fetchImpl);
    if (generated) return generated;
  }
  const bank = questionBank();
  if (bank.length === 0) return null;
  const state = getGuildData(guildId, STARTER_STATE_KEY, {});
  const index = pickQuestionIndex(bank.length, state.recentIndexes ?? [], random);
  updateGuildData(
    guildId,
    STARTER_STATE_KEY,
    (s) => ({ ...s, recentIndexes: rememberIndex(s.recentIndexes, index) }),
    {},
  );
  return bank[index];
}
