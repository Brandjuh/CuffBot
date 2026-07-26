// Speech-to-text through Groq's Whisper endpoints (S101 = M21.1).
//
// Owner decision 2026-07-26: Groq, because the precinct already has a
// GROQ_API_KEY for the detective module — which means this whole feature adds
// **no npm dependency at all**. Node ≥18 ships `fetch`, `FormData` and `Blob`,
// and a multipart upload is exactly those three. Rejected at the same time: a
// local whisper.cpp (a binary and a model file the owner would have to install
// by hand, defeating the Pi's unattended self-update) and Gemini (works, but
// Groq is real Whisper).
//
// `fetchImpl` is injectable for the same reason it is in detective's
// providers.js: the whole suite must run with no network.

/**
 * Whisper large-v3 for translation — it is the only model Groq's translation
 * endpoint accepts — and the turbo variant when the audio should stay in its
 * spoken language, because it is markedly faster and translation is the only
 * thing it cannot do.
 */
export const TRANSLATE_MODEL = 'whisper-large-v3';
export const TRANSCRIBE_MODEL = 'whisper-large-v3-turbo';

const TRANSLATIONS_URL = 'https://api.groq.com/openai/v1/audio/translations';
const TRANSCRIPTIONS_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';

export const hasAudioKey = (env) => Boolean(env?.GROQ_API_KEY);

/** Read a response body safely for error messages (never throws). */
async function safeText(res) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '(unreadable body)';
  }
}

/**
 * Download an attachment into memory. Kept here rather than in the service so
 * the size ceiling is enforced on the actual bytes, not only on the size
 * Discord advertised.
 *
 * @returns {Promise<{ bytes: Uint8Array, contentType: string }>}
 */
export async function downloadAudio(url, { fetchImpl = fetch, timeoutMs = 30_000, maxBytes } = {}) {
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`audio download HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  if (maxBytes && buffer.byteLength > maxBytes) {
    throw new Error(`audio is ${buffer.byteLength} bytes, over the ${maxBytes} limit`);
  }
  return {
    bytes: new Uint8Array(buffer),
    contentType: res.headers?.get?.('content-type') || 'application/octet-stream',
  };
}

/**
 * Speech in, text out.
 *
 * @param {object} options
 * @param {Uint8Array} options.bytes the audio file
 * @param {string} options.filename Whisper infers the container from the extension, so this matters
 * @param {boolean} [options.translate] true = always English (the owner's default)
 * @param {object} options.env process.env, or a fake
 * @returns {Promise<string>} the transcript, trimmed (empty string = silence)
 */
export async function transcribeAudio({
  bytes,
  filename = 'audio.ogg',
  contentType = 'application/octet-stream',
  translate = true,
  env,
  fetchImpl = fetch,
  timeoutMs = 60_000,
}) {
  if (!hasAudioKey(env)) throw new Error('groq: no GROQ_API_KEY configured');

  const form = new FormData();
  form.append('file', new Blob([bytes], { type: contentType }), filename);
  form.append('model', translate ? TRANSLATE_MODEL : TRANSCRIBE_MODEL);
  form.append('response_format', 'json');
  // Whisper hallucinates fluent nonsense on silence at higher temperatures;
  // 0 is what the model card recommends for a faithful transcript.
  form.append('temperature', '0');

  const res = await fetchImpl(translate ? TRANSLATIONS_URL : TRANSCRIPTIONS_URL, {
    method: 'POST',
    // No Content-Type header on purpose: fetch derives it from the FormData,
    // including the multipart boundary. Setting it by hand breaks the upload.
    headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`groq audio HTTP ${res.status}: ${await safeText(res)}`);
  const data = await res.json();
  if (typeof data?.text !== 'string') throw new Error('groq audio: no text in response');
  return data.text.trim();
}
