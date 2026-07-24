// Free-tier AI providers, selected by which API key the owner put in .env.
// Zero dependencies: plain fetch (global since Node 18). `fetch` is injectable
// so tests exercise request/response shapes without any network.
//
// Provider contract: { name, keyEnv, model(env), configured(env),
//                      complete({ system, messages, env, fetchImpl, timeoutMs }) → string }

const GROQ_DEFAULT_MODEL = 'llama-3.1-8b-instant';
// Owner decision 2026-07-24: Gemini 2.5 Flash Lite (their dashboard: RPM 10,
// TPM 250K, RPD 20 — the RPD cap is enforced via each provider's dailyLimit).
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash-lite';

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
  // Groq free tier for llama-3.1-8b-instant (documented dev tier): RPM 30,
  // RPD 14,400. Our 7 s cooldown keeps RPM ≤ ~8.6, and the owner's 62/hour
  // cap tops out at 1,488/day — both far inside the tier, but the RPD is
  // recorded and enforced anyway so a future limit change has one honest
  // knob (CUFFBOT_AI_DAILY_LIMIT overrides if your dashboard differs).
  dailyLimit: 14_400,
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
  dailyLimit: 20, // owner's free-tier dashboard: 20 requests/day for this model
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

/**
 * The daily request cap to enforce for a provider: an explicit
 * CUFFBOT_AI_DAILY_LIMIT wins (0 or negative = uncapped), else the provider's
 * free-tier default. null = no cap.
 */
export function dailyLimitFor(provider, env) {
  const raw = env.CUFFBOT_AI_DAILY_LIMIT;
  if (raw !== undefined && raw !== '') {
    const n = Number(raw);
    if (Number.isFinite(n)) return n > 0 ? Math.floor(n) : null;
  }
  return provider?.dailyLimit ?? null;
}
