# Module: detective 🕵️

> The precinct detective — talk to CuffBot. `/ask` a question or just mention the bot; a free-tier AI provider (Groq or Gemini) answers in character, in your language, under one strict server-wide budget.

## At a glance

| | |
|---|---|
| **Purpose** | AI conversation (owner request, M9): members can ask the bot questions and get real answers |
| **Commands** | `/ask` (everyone), `/ai-config` (admin) — both also as `!ask` / `!ai-config` |
| **Events** | `MessageCreate` — replies when the bot is @mentioned (needs Message Content intent) |
| **Provider** | Groq (`GROQ_API_KEY`) or Google Gemini (`GEMINI_API_KEY`) — free tiers; picked automatically by which key exists |
| **Rate limit** | **Server-wide, everyone combined:** 1 question / 7 s **and** 62 / rolling hour (owner spec) **and** the provider's free-tier daily cap — Gemini: **20 / rolling 24 h** (owner's dashboard, S27). Override: `CUFFBOT_AI_DAILY_LIMIT` (0 = off) |
| **Data** | `aiConfig` (enabled flag) in the guild store; conversation memory is in-RAM only, never on disk |
| **Dependencies** | none beyond `fetch` (built into Node ≥18) — zero new packages |

## Owner setup (one-time)

1. Create ONE free API key:
   - **Groq** (recommended: fast, generous free tier): <https://console.groq.com> → *API Keys* → *Create API Key*
   - **Gemini**: <https://aistudio.google.com> → *Get API key*
2. On the Pi, add it to `/home/brand/CuffBot/.env` (see `.env.example`):
   ```
   GROQ_API_KEY=gsk_...        # or: GEMINI_API_KEY=...
   ```
3. `sudo systemctl restart cuffbot`
4. `/ai-config` must show the provider and model. Done.

Without a key everything else keeps working; AI commands reply "not configured". Optional env overrides: `CUFFBOT_AI_PROVIDER` (`groq`/`gemini`, when both keys exist), `CUFFBOT_AI_MODEL` (defaults: `llama-3.1-8b-instant` / **`gemini-2.5-flash-lite`** — owner decision S27), and `CUFFBOT_AI_DAILY_LIMIT` (bot-side daily cap protecting the provider's RPD quota; defaults gemini 20, groq 14 400 — its free-tier RPD, recorded S28; the 7 s cooldown already keeps RPM far under both providers' limits).

## Commands

### /ask

- **Options:** `question` (string, required; greedy in text form — `!ask how do sirens work` takes the whole line).
- **What happens:** defers the reply (providers take seconds), runs the shared pipeline: enabled? → provider configured? → question non-empty (≤1000 chars, longer is cut)? → **global rate limit incl. the daily cap** → provider call (20 s timeout) → reply clamped to 1900 chars, `@everyone`/`@here` neutered, no mentions ping.
- **Reply:** public `🕵️ <answer>`; refusals are specific and in-theme (cooldown: "one question per 7 seconds for the whole precinct, try again in Xs"; budget: "hourly detective budget (62 questions) is spent, new slot in ~Xm"; daily: "DAILY detective budget (20 questions on the free gemini tier) is spent"; no key: points the owner at this manual). A provider-side HTTP 429 gets its own "free-tier quota tapped out" message.
- **Failure modes:** provider/network error → "phone line dropped" message (logged with the real error in `journalctl`); never a crash, never a hanging "thinking…".

### /ai-config (admin — Manage Server)

- **Options:** `enabled` (bool, optional; omit to view).
- **Reply (ephemeral / DM for `!ai-config`):** enabled, detected provider + model (⚠️ warning when keyless), the rate limit, questions used this hour, and the conversation-memory settings.

## Mention replies

Mentioning the bot (`@Cuffbot what's a 10-4?`) answers in the channel as a reply, through the exact same pipeline and the same budget as `/ask`. Guards: home guild only, no bots, no system messages, `@everyone`/`@here`/role-only pings never trigger it, `!`-prefixed messages are left to the prefix router. **Requires the Message Content intent** — without it the bot silently doesn't see message text, and only `/ask` (and `!ask`… which also needs the intent) works; slash `/ask` always works.

## How it works

- `lib/ratelimit.js` (pure): one process-global sliding-window limiter — `take(now)` grants/refuses with `retryAfterMs`; state is in-memory (a restart forgets ≤1 h of history, which only errs generous; keeps the hot path off the SD card).
- `lib/prompt.js` (pure): persona (police detective flavor, answer in the asker's language, ~150 words, decline harmful/personal-data asks, point moderation questions to /commands), question/reply normalization, and per-channel history pruning (last 8 exchanges, 30 min TTL).
- `lib/providers.js` (pure-ish, injectable `fetch`): Groq (OpenAI-shaped `chat/completions`) and Gemini (`generateContent`), each `≤400` output tokens, 20 s `AbortSignal.timeout`. `pickProvider(env)` = pinned override or first configured key.
- `service.js`: the one pipeline both entry points share (`askDetective` never throws — every failure is a user-ready message), the global limiter, in-RAM per-channel memory (`Map`), `aiConfig` store access.
- Multi-user conversations work: each user turn is stored as `Name: question`, so the model can tell speakers apart within a channel's memory window.

## Safety rails

- **Budget before tokens:** the rate limit (incl. the daily cap) is checked before any provider call — refused questions cost nothing. The chat-starter's AI questions draw from this same budget, and members' questions outrank ice-breakers (a refused slot silently falls back to the question list).
- The persona forbids inventing facts about members and declines harmful/personal-data requests; the bot cannot be talked into running commands (it has no such path — it only ever returns text).
- Replies never ping: `allowedMentions: { parse: [] }` plus zero-width-breaking of `@everyone`/`@here` inside model text.
- Question and reply length hard-capped; empty/whitespace questions refused before touching the budget.
- API keys live only in `.env` (gitignored); they are never logged — provider errors log status + a 300-char body snippet, not headers.

## Testing

- `test/detective-lib.test.js` — limiter (7 s edge, 62-cap, rolling-window aging, usage), prompt (trim/cut/TTL/name-folding/`@everyone` neutering), providers against **fake fetch** (request shape, auth headers, role mapping, HTTP + malformed-body errors), `pickProvider` matrix.
- `test/detective-commands.test.js` — pipeline happy path incl. conversation memory across calls, keyless/config/disabled/empty/cooldown/provider-error branches, `/ask` defer→edit, `/ai-config` toggle+status, mention stripping, mention-event gates (@everyone, no-mention, missing intent, bots, prefix collision).
- **No test ever touches the network**; ambient `GROQ_API_KEY`/`GEMINI_API_KEY` are deleted at suite start so results are machine-independent.
- **Manual (live server) checklist:**
  1. Without a key: `/ask question: test` → "not configured" message. `/ai-config` shows ⚠️ none.
  2. Add the key, restart, `/ai-config` → provider + model shown.
  3. `/ask question: wat is een 10-4?` → Dutch answer, in character.
  4. `@Cuffbot hoe werkt een portofoon?` → channel reply.
  5. Ask twice within 7 s (second person) → cooldown refusal mentioning ~seconds.
  6. `!ask does the text path work` → same behavior as slash.
  7. Follow-up question in the same channel → the answer shows it remembered the previous exchange.
  8. `/ai-config enabled:False` → "off duty" refusals; `enabled:True` restores.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "No AI provider is configured" | Key missing/typo'd in `.env`, or not restarted | Check `.env` line, `sudo systemctl restart cuffbot`, `/ai-config` |
| "phone line dropped" every time | Invalid/revoked key, provider outage, or model name typo | `journalctl -u cuffbot -n 50` shows the real HTTP error; regenerate the key or unset `CUFFBOT_AI_MODEL` |
| Mentioning the bot does nothing | Message Content intent off | `/ask` still works; enable the intent (see `operations/raspberry-pi.md`) and restart |
| Constant hourly-budget refusals | 62/h is genuinely spent, or a member is farming | It resets on a rolling hour; `/ai-config` shows usage. Limits are owner-spec — changing them is a code change (`lib/ratelimit.js DEFAULT_LIMITS`) |
| Answers in the wrong language | Model quirk | Re-ask explicitly ("antwoord in het Nederlands") — the persona already requests the asker's language |

## Changelog

| Session | Change |
|---|---|
| S17 | Created: `/ask`, `/ai-config`, mention replies, Groq+Gemini free-tier providers, server-wide 1/7s + 62/h budget, per-channel conversation memory. |
| S27 | Gemini default model → `gemini-2.5-flash-lite` (owner decision; dashboard limits RPM 10 / TPM 250K / RPD 20); bot-side DAILY cap (gemini 20/day, `CUFFBOT_AI_DAILY_LIMIT` override); specific 429 message; chat-starter AI shares this budget. |
