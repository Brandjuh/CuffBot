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

/**
 * Claim one transcription from today's budget BEFORE spending it (S22:
 * claim-before-send). Two memos landing together must not both see the last
 * slot free.
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
  if (!claimBudget(guildId, now)) return { ok: false, reason: 'daily-limit' };

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
    return { ok: false, reason: 'failed', detail: String(error?.message ?? error) };
  }
}
