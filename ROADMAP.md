# CuffBot — Roadmap

Milestones sized so one focused session can finish one (build + tests + manual + state). Sessions pick the first unchecked milestone unless `STATE.md`'s resume point or the owner says otherwise. Acceptance criteria are the contract — a milestone is done when every box checks, not when the code "looks done". Update this file when scope changes, and record why in `SESSION_LOG.md`.

Theme reference: `.claude/skills/run-skill-generator/references/architecture.md → Police theme vocabulary`.

- [x] **M0 — Build system** *(Session 0)*
  The `run-skill-generator` skill, state files, roadmap, manual template, docs index.

- [x] **M1 — Bot core: on the air** 📻 *(Session 1)*
  `package.json` (ESM; scripts `start` / `test` / `deploy-commands`), `src/index.js`, `src/core/{config,logger,loader}.js`, `src/deploy-commands.js`, module `core` with `/radio-check` (latency check), `.env.example`, loader smoke test.
  *Accept when:* `npm test` passes; `node --check` clean on all files; boot fails fast with a clear message when `.env` is missing; `docs/modules/core.md` complete per template; README quickstart section written.

- [x] **M2 — Enforcement: arm of the law** 🚨 *(Session 7 — includes the owner-requested Papers-Please-style citation tickets)*
  Module `enforcement`: `/cite` (warn, delivered as a generated ticket image), `/detain` (timeout with duration option), `/release` (lift timeout / unban), `/arrest` (ban, with message-deletion window option). Hierarchy + permission checks per `discord-reference.md`; audit-log reasons always set; duration parsing in `lib/` with tests.
  *Accept when:* all four commands registered and syntax-clean; lib tests pass (incl. duration edge cases: `10m`, `2h`, `7d`, invalid); every failure mode replies specifically; `docs/modules/enforcement.md` complete incl. owner's live-test checklist.

- [x] **M3 — Records: the rap sheet** 📋 *(Session 8)*
  `src/core/store.js` (atomic JSON per guild, gitignored `data/`), module `records`: infractions written by enforcement actions, `/rapsheet` (view a member's history, ephemeral), retention/clear command for admins.
  *Accept when:* store has tests (concurrent-ish writes, missing file, corrupt file recovery); enforcement writes records; `/rapsheet` paginates or truncates gracefully; manual complete.

- [x] **M4 — Dispatch: the evidence locker** 🗄️ *(Session 11)*
  Module `dispatch`: configurable log channel (evidence locker) receiving enforcement/records events; `/dispatch` announcement command for the force.
  *Accept when:* log channel configurable per guild via command + stored in records store; missing-channel and missing-permission cases handled; manual complete.

- [x] **M5 — Academy: ranks** 🎖️ *(Session 12 — adopts the server’s existing leveler ranks, not a fixed ladder)*
  Module `academy`: rank ladder (Cadet → Chief) mapped to guild roles via config, `/promote`, `/demote`, `/ranks`. Role-hierarchy safety per `discord-reference.md`.
  *Accept when:* ladder logic lives in `lib/` with tests; misconfigured/missing roles reported clearly; manual complete.

- [x] **M6 — Patrol: automod** 👮 *(Session 13)*
  Module `patrol`: message screening (banned terms, invite links, basic spam heuristic) with actions routed through enforcement/records; `/patrol` to view/toggle rules. Needs `MessageContent` privileged intent — document the portal steps in the manual.
  *Accept when:* screening logic in `lib/` with tests; per-guild toggle stored; false-positive story documented; manual complete.

- [x] **M7 — Public Affairs: community** 🍩 *(Session 14)*
  Module `public-affairs`: `/badge` (member card: join date, rank, record count), `/wanted` (playful poster embed), `/donut` (fun), `/911` (report to the force → evidence locker).
  *Accept when:* commands work without privileged intents where possible; `/911` respects anonymity choice; manual complete.

- [x] **M8 — Deployment & operations** 🚀 *(large slices delivered early: S2 Pi installer + runbook, S5 doctor, S7 test-gated self-update timer; S15 backup/rotation docs + final audit)*
  Remaining: token rotation runbook polish, troubleshooting FAQ sweep.
  *Accept when:* a competent non-expert can take the repo to a live bot using `docs/` alone; ops runbook reviewed against `discord-reference.md → Token hygiene`.

---

## Backlog — owner feature requests (M9+, not yet scheduled)

Captured from the owner; each becomes its own milestone (build + tests + manual + state) when scheduled. Several are independent and could be reordered.

- [x] **M9 — AI conversation** 🕵️ *(Session 17 — module `detective`)* — `/ask` + `/ai-config` + reply-when-mentioned via a free-tier provider (Groq or Gemini, auto-picked by whichever API key the owner puts in `.env`; `CUFFBOT_AI_PROVIDER`/`CUFFBOT_AI_MODEL` overrides). **Owner rate-limit spec implemented exactly: GLOBAL budget shared by everyone combined — 1 AI message / 7 s and 62 / rolling hour** — checked before any tokens are spent. Per-channel conversation memory (8 exchanges, 30 min, RAM-only). Zero new dependencies. Owner setup: one key in `.env` + restart (`docs/modules/detective.md`).
- [x] **M10 — Birthdays** 🎂 *(Session 19 — module `birthdays`)* — `/birthday-set` (day+month+IANA timezone, no birth year stored), `/birthday-remove`, `/birthdays` (upcoming, per-member timezone), `/birthday-config` (admin: channel+enabled). 10-minute idempotent sweep instead of a missable midnight job; announces on the member's own calendar day, once per local year (stamp-before-send); Feb 29 → Mar 1 in non-leap years.
- [x] **M11 — Police trivia** ❓ *(Session 20 — module `trivia`)* — `/trivia [set]` buttoned rounds (first correct answer wins, one guess each, 20 s reveal with facts), `/trivia-scores` persistent leaderboard, `/trivia-sets`. Question banks are plain JSON files in `data/` (validated at load, invalid files skipped loudly); ships with `police-codes` + `world-police` (10 questions each). New sets appear in the picker on the next deploy.
- [ ] **M12 — Fallen tracker** 🕯️ — poll RSS feeds and post new entries, tagging a role:
  - Fallen firefighters: `https://www.firehero.org/feed/` → role `627943529544417300`
  - Fallen officers: `https://www.odmp.org/feed` → role `451095508560379934`
  - Needs an RSS fetch+parse (pure, testable), a "seen" store to avoid reposts, a target channel, and a polling scheduler.
- [ ] **M13 — Starboard** ⭐ — react with X ⭐ on a message → it's reposted to a starboard/"reminder" channel. Configurable threshold + channel; store which messages were already boarded.
- [ ] **M14 — Goal tracker** 🎯 — track goals/progress (scope to define with the owner).
- [ ] **M15 — Chat starter** 💬 — after X minutes of channel inactivity, post an open-ended question. List-based question bank (optionally AI-generated if M9 lands).
