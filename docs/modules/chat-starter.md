# Module: chat-starter 💬

> When the configured channel goes quiet for too long, CuffBot posts an open-ended question to get the precinct talking again — list-based, optionally AI-generated, and it never monologues.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (M15): "open-ended question after X amount of time no activity — list based (maybe AI thing)" |
| **Commands** | `!chatstarter` group (admin, S70; alias `!chatstarter`) |
| **Events** | `MessageCreate` (activity tracking, RAM only) + `ClientReady` (5-minute sweep) |
| **Data** | `chatStarterConfig` (enabled, channelId, idleMinutes, useAi) + `chatStarterState` (recent-question ring) in the guild store |
| **Question bank** | `data/questions.json` — 40 open-ended questions (validated at load); AI generation optional via the detective's provider |
| **Default** | **On for the owner's channel** (S30, owner decision): channel `411609312037961729`, 12 h idle. `!chatstarter` overrides win; other installs can disable or repoint freely |

## Commands

### !chatstarter (admin — Manage Server; S70 group command, alias `!chatstarter`)

Bare `!chatstarter` = the status view, including the question source: the list (with count), or AI with list fallback — and a ⚠️ when AI is on but no provider key exists. Subcommands:

| Subcommand | Does |
|---|---|
| `!chatstarter on` / `!chatstarter off` | Starter on/off (off by default) |
| `!chatstarter channel <#channel>` | Channel to revive when it goes quiet |
| `!chatstarter idle <15–1440>` | Minutes of silence before a starter (default 720 = 12 h) |
| `!chatstarter ai <on\|off>` | Generate questions via the detective (list fallback) |
| `!chatstarter preview` | Show a sample question (posts nothing) |
| `!chatstarter test` | S30 — arms **one real starter ~30 seconds from now** in the configured channel, bypassing the idle window and monologue guard |

## How it works

- **Activity tracking** (RAM): every message in the configured channel updates its last-activity time. The bot's own starter doesn't count as conversation; other bots reset the idle clock but only **humans** re-arm the next starter.
- **The sweep** (every 5 min): posts when the channel has been silent ≥ `idle-minutes` **and** at least one human spoke since the previous starter — the never-monologue guard. **Restarts don't reset the clock (S30):** at boot the idle clock is seeded from the channel's real last message (one history fetch); if that last message is the bot's own starter, the monologue guard stays armed-off. Only if history is unreadable does the window fall back to boot time.
- **Question choice:** with `use-ai:True` and a detective provider key, one short ice-breaker is generated (15 s call). **It draws from the same shared AI budget as `/ask`** (free tiers cap requests per day — Gemini: 20); when the budget refuses, the list is used silently — members' questions outrank ice-breakers. Malformed/too-short output is rejected; any AI trouble falls back to the list. List picks avoid the last 10 questions used (persisted ring).
- Starters never ping (`allowedMentions: { parse: [] }`).

## Adding questions

Edit `src/modules/chat-starter/data/questions.json` — a plain array of strings. Validated at load; an unusable bank logs a warning and the module goes quiet rather than crashing.

## Testing

- `test/chat-starter.test.js` (11 tests): shipped-bank validity (30+ questions), bank validation, the `shouldPost` matrix (opt-in / channel / idle threshold / human guard), recent-ring avoidance without starvation, ring bounding, activity semantics (human re-arm, bot-own no re-arm, other-bot clock-only), the activity event, no-repeat drawing, AI-path (no key → null → list fallback; provider output accepted/junk rejected via fake fetch), and the sweep end-to-end (not-idle → posts → refuses to monologue → human re-arms → posts again; failure tolerance).
- **Manual (live server) checklist:**
  1. `!chatstarter channel #general` then `!chatstarter idle 15`, `!chatstarter on`, `!chatstarter preview` → a sample question.
  2. Leave the channel silent 15+ min → a starter appears (within the 5-min sweep grain).
  3. Stay silent another 15 min → **no** second starter (never monologues).
  4. Reply to it; go silent again → a new starter arrives.
  5. With a detective key set: `use-ai:True preview:True` → the sample is AI-generated (varies each time).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Never posts | Disabled (default), no channel, or nobody ever spoke after the last starter | `!chatstarter` shows all gates |
| Posts feel late | The sweep runs every 5 min — worst case idle+5 | Expected grain |
| Same question repeats quickly | Ring only remembers the last 10 | Expected with heavy use; add questions to the bank |
| AI questions never appear | `use-ai` on but no `GROQ_API_KEY`/`GEMINI_API_KEY` | The status embed warns about exactly this; add a key (see detective manual) |

## Changelog

| Session | Change |
|---|---|
| S23 | Created: idle-watch + 5-min sweep, never-monologue guard, 40-question bank with no-repeat ring, optional AI generation with list fallback, opt-in by default. |
| S30 | Owner defaults committed (channel 411609312037961729, 12 h, enabled); boot seeds the idle clock from real channel history; `test` option posts a real starter in ~30 s. |
| S55 | Channel picker accepts Announcement (news) channels too (was text-only — an unselectable type read as "the bot can't post despite full rights"); posting resolves the configured channel via the API on a cache miss (`core/channels.js`). |
| S70 | Converted to the `!chatstarter` group (M17.2; alias `!chatstarter`): on/off, channel, idle, ai, preview, test. |
