// Free-tier AI providers, selected by which API key the owner put in .env.
// Zero dependencies: plain fetch (global since Node 18). `fetch` is injectable
// so tests exercise request/response shapes without any network.
//
// Provider contract: { name, keyEnv, model(env), configured(env),
//                      complete({ system, messages, env, fetchImpl, timeoutMs }) → string }

const GROQ_DEFAULT_MODEL = 'llama-3.1-8b-instant';
const GEMINI_DEFAULT_MODEL = 'gemini-2.0-flash';

/** Read a response body safely for error messages (never throws). */
async function safeText(res) {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '(unreadable body)';
  }
}

export const groqProvider = {
  name: 'groq',
  keyEnv: 'GROQ_API_KEY',
  model: (env) => env.CUFFBOT_AI_MODEL || GROQ_DEFAULT_MODEL,
  configured: (env) => Boolean(env.GROQ_API_KEY),
  async complete({ system, messages, env, fetchImpl = fetch, timeoutMs = 20_000 }) {
    const res = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.GROQ_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model(env),
        messages: [{ role: 'system', content: system }, ...messages],
        max_tokens: 400,
        temperature: 0.7,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`groq HTTP ${res.status}: ${await safeText(res)}`);
    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content;
    if (typeof text !== 'string') throw new Error('groq: no completion in response');
    return text;
  },
};

export const geminiProvider = {
  name: 'gemini',
  keyEnv: 'GEMINI_API_KEY',
  model: (env) => env.CUFFBOT_AI_MODEL || GEMINI_DEFAULT_MODEL,
  configured: (env) => Boolean(env.GEMINI_API_KEY),
  async complete({ system, messages, env, fetchImpl = fetch, timeoutMs = 20_000 }) {
    const url =
      'https://generativelanguage.googleapis.com/v1beta/models/' +
      `${encodeURIComponent(this.model(env))}:generateContent`;
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'x-goog-api-key': env.GEMINI_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: 400, temperature: 0.7 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`gemini HTTP ${res.status}: ${await safeText(res)}`);
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
    if (typeof text !== 'string' || text.length === 0) {
      throw new Error('gemini: no completion in response');
    }
    return text;
  },
};

export const PROVIDERS = [groqProvider, geminiProvider];

/**
 * The provider to use: CUFFBOT_AI_PROVIDER pins one explicitly; otherwise the
 * first provider whose key is present wins (Groq, then Gemini).
 * @returns {object|null} null when no provider is configured
 */
export function pickProvider(env) {
  const pinned = (env.CUFFBOT_AI_PROVIDER ?? '').toLowerCase().trim();
  if (pinned) {
    const p = PROVIDERS.find((x) => x.name === pinned);
    return p && p.configured(env) ? p : null;
  }
  return PROVIDERS.find((p) => p.configured(env)) ?? null;
}
