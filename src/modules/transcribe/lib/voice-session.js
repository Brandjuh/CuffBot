// The rules a live voice transcription follows (S102 = M21.2). Pure — no
// discord.js, no timers, no network — so the timing policy is tested with
// injected numbers instead of by sitting in a voice channel with a stopwatch.
//
// The impure half (joining, subscribing, streaming) lives in ../voice/.
import { SAMPLES_PER_FRAME, SAMPLE_RATE, durationOf } from './ogg.js';

export const DEFAULT_VOICE_POLICY = {
  /**
   * How long a speaker must stop talking before their turn is considered
   * finished. Short enough that a transcript keeps up with the conversation,
   * long enough that a breath mid-sentence does not split it in two.
   */
  silenceMs: 800,
  /**
   * Ignore anything shorter than this. Discord emits a stream for a cough, a
   * keyboard click and an "mm" — transcribing those costs an API call each and
   * produces Whisper's favourite hallucination, "Thank you.".
   */
  minSpeechMs: 700,
  /**
   * Force a cut in a monologue. Without it a continuous speaker produces one
   * stream that never ends, so nothing is transcribed until they stop — and
   * the buffer grows the whole time.
   */
  maxChunkMs: 25_000,
  /** Refuse to buffer beyond this even if maxChunkMs somehow passes. */
  hardCapMs: 60_000,
};

/** Milliseconds of audio in a run of 20 ms Opus frames. */
export const packetsToMs = (count) => (count * SAMPLES_PER_FRAME * 1000) / SAMPLE_RATE;
export const msToPackets = (ms) => Math.ceil((ms * SAMPLE_RATE) / (SAMPLES_PER_FRAME * 1000));

/**
 * Should the capture so far be cut and sent, mid-stream? Called as packets
 * arrive, so it must be cheap and must never depend on wall-clock time — the
 * packet count IS the clock, and it is exact.
 */
export function shouldFlush(packetCount, policy = DEFAULT_VOICE_POLICY) {
  const settings = { ...DEFAULT_VOICE_POLICY, ...policy };
  return packetsToMs(packetCount) >= settings.maxChunkMs;
}

/** Hard ceiling: stop accepting packets rather than grow without bound. */
export function isOverCap(packetCount, policy = DEFAULT_VOICE_POLICY) {
  const settings = { ...DEFAULT_VOICE_POLICY, ...policy };
  return packetsToMs(packetCount) >= settings.hardCapMs;
}

/**
 * Is a finished capture worth an API call?
 * @returns {{ ok: boolean, reason: string, seconds: number }}
 */
export function isWorthTranscribing(packets, policy = DEFAULT_VOICE_POLICY) {
  const settings = { ...DEFAULT_VOICE_POLICY, ...policy };
  const seconds = durationOf(packets);
  if (packets.length === 0) return { ok: false, reason: 'empty', seconds };
  if (seconds * 1000 < settings.minSpeechMs) return { ok: false, reason: 'too-short', seconds };
  return { ok: true, reason: 'ok', seconds };
}

/**
 * Whisper's silence hallucinations. It returns fluent, confident sentences for
 * a second of room tone, and the same handful of them every time — filtering
 * the known set is cheaper and far more effective than trying to detect
 * silence in the audio ourselves.
 */
const HALLUCINATIONS = [
  'thank you',
  'thanks for watching',
  'thank you for watching',
  'you',
  'bye',
  'bye.',
  '.',
  'thank you.',
  'subtitles by the amara.org community',
  'transcription by castingwords',
  'please subscribe',
  'okay',
];

/** Strip a transcript that is really just silence. Returns '' when it is. */
export function cleanTranscript(text) {
  const trimmed = String(text ?? '').trim();
  const bare = trimmed.toLowerCase().replace(/[!?.,\s]+$/g, '').trim();
  if (bare.length === 0) return '';
  if (HALLUCINATIONS.includes(bare)) return '';
  return trimmed;
}

/** `[14:32] Alice: Suspect fled north.` — one line of the log. */
export function formatLine({ name, text, at, timestamps = true }) {
  const clean = cleanTranscript(text);
  if (clean === '') return null;
  if (!timestamps) return `**${name}:** ${clean}`;
  const stamp = new Date(at).toISOString().slice(11, 16); // HH:MM, UTC
  return `\`${stamp}\` **${name}:** ${clean}`;
}

/**
 * Pack transcript lines into Discord-sized posts, splitting only between
 * lines. A transcript that arrives as one message per utterance would flood
 * the channel; one that silently drops the overflow would be worse.
 */
export function packLines(lines, limit = 1900) {
  const posts = [];
  let current = '';
  for (const line of lines) {
    const piece = String(line);
    if (current.length > 0 && current.length + 1 + piece.length > limit) {
      posts.push(current);
      current = '';
    }
    // A single line longer than the limit is hard-split rather than dropped.
    if (piece.length > limit) {
      if (current.length > 0) {
        posts.push(current);
        current = '';
      }
      for (let i = 0; i < piece.length; i += limit) posts.push(piece.slice(i, i + limit));
      continue;
    }
    current = current.length === 0 ? piece : `${current}\n${piece}`;
  }
  if (current.length > 0) posts.push(current);
  return posts;
}

/**
 * A buffer that batches lines and says when it wants flushing — either because
 * enough time has passed or because it is nearly a full post. Both thresholds
 * are injected, and `now` is a parameter, so there is nothing to wait for in a
 * test.
 */
export function createLineBuffer({ flushAfterMs = 5_000, softLimit = 1_500 } = {}) {
  let lines = [];
  let firstAt = null;
  return {
    add(line, now) {
      if (line === null || line === undefined) return;
      if (lines.length === 0) firstAt = now;
      lines.push(line);
    },
    get size() {
      return lines.length;
    },
    get length() {
      return lines.reduce((sum, l) => sum + l.length + 1, 0);
    },
    /** Time-based OR size-based; a long silence must not strand a line forever. */
    shouldFlush(now) {
      if (lines.length === 0) return false;
      return now - firstAt >= flushAfterMs || this.length >= softLimit;
    },
    drain() {
      const out = lines;
      lines = [];
      firstAt = null;
      return out;
    },
  };
}
