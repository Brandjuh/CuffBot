// Transcription storage and the one orchestration function (S101 = M21.1).
//
// Everything decidable lives in lib/; this file holds the config accessors,
// the daily budget counter, and the download → transcribe → format sequence.
import { getGuildData, setGuildData, updateGuildData } from '../../core/store.js';
import { downloadAudio, hasAudioKey, transcribeAudio } from './lib/audio-provider.js';
import {
  DEFAULT_TRANSCRIBE_CONFIG,
  MAX_AUDIO_BYTES,
  eligibility,
  isVoiceMessage,
  spendBudget,
  transcriptEmbed,
} from './lib/transcribe.js';
import { checkBudget, describeUsage, emptyUsage, recordSpend } from './lib/limits.js';

export const TRANSCRIBE_CONFIG_KEY = 'transcribeConfig';
export const TRANSCRIBE_BUDGET_KEY = 'transcribeBudget';

export function getTranscribeConfig(guildId) {
  return { ...DEFAULT_TRANSCRIBE_CONFIG, ...getGuildData(guildId, TRANSCRIBE_CONFIG_KEY, {}) };
}

export function setTranscribeConfig(guildId, patch) {
  const stored = { ...getGuildData(guildId, TRANSCRIBE_CONFIG_KEY, {}), ...patch };
  setGuildData(guildId, TRANSCRIBE_CONFIG_KEY, stored);
  return { ...DEFAULT_TRANSCRIBE_CONFIG, ...stored };
}

export const getBudget = (guildId) => getGuildData(guildId, TRANSCRIBE_BUDGET_KEY, { day: null, used: 0 });

export const RATE_KEY = 'transcribeRate';

/**
 * Claim capacity against **Groq's own published limits** before spending it
 * (S123). Claim-before-send (S22): two turns landing together must not both
 * see the last slot free.
 *
 * This replaced an invented `dailyLimit: 100`. Groq publishes 20 requests a
 * minute, 2,000 a day, 7,200 audio-seconds an hour and 28,800 a day, with a
 * **10-second minimum billed per request** — so the honest budget is those
 * four windows, not one number somebody chose.
 *
 * `dailyLimit` survives as an OPTIONAL extra ceiling for a precinct that wants
 * to spend less than Groq allows; `0` (the new default) means "only Groq's".
 *
 * @param {number} seconds  the audio being sent, for the audio-second windows
 * @returns {{ok: boolean, reason: string, retryAfterMs: number, cost: number}}
 */
export function claimRate(guildId, seconds, now = Date.now()) {
  let verdict = { ok: false, reason: 'unknown', retryAfterMs: 0, cost: 0 };
  updateGuildData(
    guildId,
    RATE_KEY,
    (usage) => {
      verdict = checkBudget(usage, seconds, { now });
      if (!verdict.ok) return verdict.usage;
      return recordSpend(verdict.usage, verdict.cost, now);
    },
    emptyUsage(),
  );
  return verdict;
}

/** Hand capacity back when the request never actually went out. */
export function releaseRate(guildId, cost, now = Date.now()) {
  updateGuildData(
    guildId,
    RATE_KEY,
    (usage) => {
      const requests = [...(usage?.requests ?? [])];
      const audio = [...(usage?.audio ?? [])];
      requests.pop();
      // Remove the matching audio entry rather than the last one blindly, so a
      // concurrent spend is not the thing that gets refunded.
      const idx = audio.findIndex((e) => e.seconds === cost && e.at <= now);
      if (idx >= 0) audio.splice(idx, 1);
      else audio.pop();
      return { requests, audio };
    },
    emptyUsage(),
  );
}

/** Current usage against every window, for the status line. */
export const rateUsage = (guildId, now = Date.now()) =>
  describeUsage(getGuildData(guildId, RATE_KEY, emptyUsage()), { now });

/**
 * The optional precinct-imposed daily cap, on top of Groq's. Default `0` = off.
 * @returns {boolean} whether the caller may proceed
 */
export function claimBudget(guildId, now = Date.now()) {
  const limit = getTranscribeConfig(guildId).dailyLimit;
  let allowed = false;
  updateGuildData(
    guildId,
    TRANSCRIBE_BUDGET_KEY,
    (counter) => {
      const spent = spendBudget(counter, limit, now);
      allowed = spent.allowed;
      return spent.counter;
    },
    { day: null, used: 0 },
  );
  return allowed;
}

/** Give a claimed slot back when the work never happened (a failed download). */
export function refundBudget(guildId) {
  updateGuildData(
    guildId,
    TRANSCRIBE_BUDGET_KEY,
    (counter) => ({ ...counter, used: Math.max(0, (Number(counter?.used) || 0) - 1) }),
    { day: null, used: 0 },
  );
}

/**
 * Transcribe audio we already hold in memory (S102: the live-voice path, whose
 * bytes come off the voice gateway rather than from a URL). Shares the key
 * check, the budget and the language setting with the memo path, because a
 * second copy of those would be a second thing to keep in step.
 *
 * @returns {Promise<{ ok: true, text: string } | { ok: false, reason: string, detail?: string }>}
 */
export async function transcribeBuffer(
  guildId,
  bytes,
  {
    filename = 'audio.ogg',
    contentType = 'audio/ogg',
    env = process.env,
    fetchImpl = fetch,
    now = Date.now(),
    // The live-voice caller counts Opus packets, so it knows the duration
    // exactly. 0 falls back to Groq's billing floor, which is the honest
    // assumption when the length is genuinely unknown.
    seconds = 0,
  } = {},
) {
  if (!hasAudioKey(env)) return { ok: false, reason: 'no-key' };
  // Groq's own limits first — they are the real ceiling and the one that
  // produces a 429 if ignored. The precinct's optional cap is checked after.
  const rate = claimRate(guildId, seconds, now);
  if (!rate.ok) return { ok: false, reason: rate.reason, retryAfterMs: rate.retryAfterMs };
  if (!claimBudget(guildId, now)) {
    releaseRate(guildId, rate.cost, now);
    return { ok: false, reason: 'daily-limit' };
  }
  try {
    const text = await transcribeAudio({
      bytes,
      filename,
      contentType,
      translate: getTranscribeConfig(guildId).translateToEnglish,
      env,
      fetchImpl,
    });
    return { ok: true, text };
  } catch (error) {
    refundBudget(guildId);
    releaseRate(guildId, rate.cost, now);
    return { ok: false, reason: 'failed', detail: String(error?.message ?? error) };
  }
}

/**
 * Transcribe the audio on a message.
 *
 * Returns a discriminated result rather than throwing, because both callers —
 * the auto path and the command — have to explain what happened, and the
 * command has to explain it differently.
 *
 * @returns {Promise<{ ok: true, embed: object, text: string }
 *                  | { ok: false, reason: string, detail?: string }>}
 */
export async function transcribeMessage(
  guildId,
  message,
  { manual = false, env = process.env, fetchImpl = fetch, now = Date.now() } = {},
) {
  const config = getTranscribeConfig(guildId);
  const verdict = eligibility(message, config, { manual });
  if (!verdict.ok) return { ok: false, reason: verdict.reason };
  if (!hasAudioKey(env)) return { ok: false, reason: 'no-key' };
  // Groq's own limits first — they are the real ceiling and the one that
  // produces a 429 if ignored. The precinct's optional cap is checked after.
  // Discord ships a duration on voice messages; a plain file has none, so it
  // is priced at the floor until the bytes prove otherwise.
  const rate = claimRate(guildId, Number(verdict.attachment?.duration) || 0, now);
  if (!rate.ok) return { ok: false, reason: rate.reason, retryAfterMs: rate.retryAfterMs };
  if (!claimBudget(guildId, now)) {
    releaseRate(guildId, rate.cost, now);
    return { ok: false, reason: 'daily-limit' };
  }

  const attachment = verdict.attachment;
  try {
    const { bytes, contentType } = await downloadAudio(attachment.url, {
      fetchImpl,
      maxBytes: MAX_AUDIO_BYTES,
    });
    const text = await transcribeAudio({
      bytes,
      filename: attachment.name || 'voice-message.ogg',
      contentType: attachment.contentType || contentType,
      translate: config.translateToEnglish,
      env,
      fetchImpl,
    });
    return {
      ok: true,
      text,
      embed: transcriptEmbed({
        text,
        authorId: message.author.id,
        durationSecs: Number(attachment.duration ?? attachment.durationSecs ?? 0),
        translated: config.translateToEnglish,
        filename: isVoiceMessage(message) ? undefined : attachment.name,
      }),
    };
  } catch (error) {
    refundBudget(guildId); // the work never happened; do not charge for it
    releaseRate(guildId, rate.cost, now);
    return { ok: false, reason: 'failed', detail: String(error?.message ?? error) };
  }
}
