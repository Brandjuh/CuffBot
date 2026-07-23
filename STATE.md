# CuffBot — Project State

> Written by the latest session. These are **claims, not truth** — run the Verification block below before building on anything here. If reality disagrees with this file, reality wins: fix this file and record the correction in `SESSION_LOG.md`.

**Last updated:** Session 17 · 2026-07-23
**Phase:** M1–M9 complete + audited; leveling (S16) and **detective/AI (S17)** live. Next: M10 birthdays (or owner's pick from the backlog).

## Verification block — run this before trusting the rest

| Check | Command | Expected right now |
|---|---|---|
| History matches the log | `git log --oneline -5` | Commits match the latest `SESSION_LOG.md` entries |
| Clean tree | `git status --short` | Empty (or only your own new work) |
| Skill intact | `ls .claude/skills/run-skill-generator/references/` | `architecture.md`, `discord-reference.md`, `module-manual-template.md`, `self-improvement.md` |
| State files present | `ls STATE.md SESSION_LOG.md ROADMAP.md CLAUDE.md docs/README.md` | All exist |
| Runtime available | `node --version` | v18 or newer (v22 as of S0) |
| Deps installed | `ls node_modules/discord.js/package.json` | Exists (else `npm install` first) |
| Syntax clean | `find src test -name '*.js' -exec node --check {} +` | No output (no errors) |
| Tests green | `npm test` | 254/254 pass as of S17 |
| Discovery smoke | `node -e "import('./src/core/loader.js').then(async m => console.log((await m.discoverModules()).map(x => x.name)))"` | `[ 'academy', 'core', 'detective', 'dispatch', 'enforcement', 'leveling', 'patrol', 'public-affairs', 'records' ]` |
| Manuals current | `ls docs/modules/` | academy, core, detective, dispatch, enforcement, leveling, patrol, public-affairs, records |
| Data gitignored | `git check-ignore data/x.json` | Prints the path (member history never committed) |
| Boot guard | `node src/index.js` (without `.env`) | Fails fast naming the missing env vars |
| Scripts sane | `bash -n scripts/setup-pi.sh scripts/update.sh` | No output |

## What exists (verified Session 17 · 2026-07-23)

- **Detective / AI (M9, S17):** module `detective` — `/ask` (everyone; greedy `question`), `/ai-config` (admin: enabled toggle + status: provider/model/hourly usage), and reply-when-@mentioned (same pipeline; needs Message Content; ignores @everyone/role pings, bots, system messages, `!`-prefixed). Providers: **Groq** (`GROQ_API_KEY`, default `llama-3.1-8b-instant`) or **Gemini** (`GEMINI_API_KEY`, default `gemini-2.0-flash`), auto-picked by key, `CUFFBOT_AI_PROVIDER`/`CUFFBOT_AI_MODEL` overrides, plain `fetch`, 20 s timeout, zero new deps. **Owner rate-limit spec implemented exactly (GLOBAL, everyone combined): 1 msg / 7 s AND 62 / rolling hour** — refused before any tokens are spent, in-theme refusals with wait times. Per-channel memory: last 8 exchanges, 30 min TTL, RAM-only. Persona: police detective, answers in the asker's language, ~150 words, declines harmful/personal-data asks. Replies never ping; `@everyone`/`@here` neutered in model text. `askDetective` never throws. Keyless = friendly "not configured" everywhere. Manual `detective.md` (incl. owner key setup).
- **Leveling (S16):** module `leveling` — CuffBot's own XP system, **replacing the old leveler bot** (owner decision S15/S16). Message XP (cooldown-gated; needs only the MessageCreate *event*, works without Message Content; system messages excluded) + voice XP (60 s sweep, one store write per tick; anti-farm: no AFK channel, ≥2 humans, not self-deafened, no bots; `GuildVoiceStates` intent added to the base set). Thresholds `round(baseXp·N^1.6)` mapped position-based onto the academy ladder; **promote-only** auto rank sync (never demotes; per-member in-flight guard against duplicate promotions) with audit reasons + no-ping announcements. **Seeding (owner requirement S16): first sight of a member with a rank role seeds their XP at that rank's threshold floor — existing members never restart at 0; rankless members start at 0 (`seededFromRank` stored).** **All automation (seeding-from-rank, auto-sync, XP coupling) requires the PINNED ladder** (academy `isPinnedLadder`; `/rank-setup` sets it) — a broken/heuristic ladder can't hand out roles or poison seeds, and under-seeded records **self-heal** (reconcile raises XP to the held rank's floor once the ladder is pinned). `/promote`/`/demote` **couple XP** to the new rank (raise-to-floor / cap-at-floor) so auto-sync never undoes a human demotion. `/level` (bot targets refused), `/leaderboard` (clamped 1–25), `/xp-config` (admin; sparse overrides only; `clear-announce`; shows pinned status). Prefix framework: text path now enforces integer min/max and `addChannelTypes`. Manual `leveling.md`.
- **Dual invocation (S9):** every command runs as `/x` AND `!x` (`src/core/prefix/` — parser, adapter, router; ephemeral→DM). `/help` (generated roster) and `/update` (manual, admin-only, test-gated) added to core. Message Content intent enabled with graceful slash-only fallback (`client.messageContentAvailable`); `config.json → prefix`. Text commands + patrol need that intent (portal enablement).
- **Finalization (S15):** real `/wanted` poster image (member avatar composited via a pure-JS PNG **decoder** + poster renderer; graceful NO-PHOTO fallback). Final adversarial audit (workflow, 6 dimensions, each finding verified) → fixed a HIGH-severity prefix-parser bug (multi-word `!cite`/`!fine`/`!arrest`/`!911` reasons; now per-command `textGreedyArg` + tail-binding), mention-injection hardening (allowedMentions on reason-echoing replies), loader event validation, channel-aware prefix permissions, doc corrections. M8 ops docs (backup/rotation). Skill 0.4.0.
- **Public Affairs (M7, S14):** module `public-affairs` — `/badge` (rank via academy `currentRank`, record count via records `recordsFor`, join date; graceful fallbacks), `/wanted` (playful poster embed, deterministic crime/bounty), `/donut` (fun), `/911` (report to the evidence locker via dispatch `sendToEvidenceLocker`; **anonymity option**, ephemeral confirm). `lib/cards.js` pure. No privileged intents. Manual `public-affairs.md`.
- **Patrol (M6, S13):** module `patrol` — automod. `lib/screen.js` (pure) screens for banned terms (evasion-aware normalization: leet/spacing/diacritics → substring), invite links, and spam (mention flood / char runs). `MessageCreate` handler gated on `client.messageContentAvailable`, mod-exempt, home-guild only; on a hit deletes + DMs + files a record + logs to the evidence locker (cross-module seams). `/patrol` (on/off/status), `/patrol-rule`, `/patrol-term`. Off by default; config in store `patrolConfig`. False-positive story documented. Needs Message Content intent. Manual `patrol.md`.
- **Academy (M5, S12):** module `academy` — adopts the **server's own rank roles** (not a fixed police ladder). `lib/ladder.js` (pure) detects ranks from roles under a `[LEVELER]`-style header, highest-first, minus managed/@everyone/excluded, stopping at the next divider; `planPromotion`/`planDemotion` normalize to one rank role. `/promote`, `/demote` (to: role option), `/ranks`, `/rank-setup` (header), `/rank-exclude`. Config in store `academyConfig={headerRoleId,excludedRoleIds}`; ladder recomputed live. `currentRank` exported for /badge (M7). Manual `academy.md`.
- **Dispatch (M4, S11):** module `dispatch` — the **evidence locker** (`/evidence-locker` set/status/clear, per-guild channel via store) receives a typed embed for every enforcement action; `/dispatch` broadcasts announcements. `lib/format.js` (pure embeds) + `lib/api.js` (`logEnforcement`, best-effort). Enforcement's four commands log to the locker via the cross-module seam, wrapped so it never blocks an action. Animation: `/cite` GIF now prints **bottom-to-top** (owner preference, S11). Manual `dispatch.md`.
- **Records (M3, S8):** `src/core/store.js` (atomic per-guild JSON, corrupt-file recovery, `CUFFBOT_DATA_DIR` override) + module `records` — case-numbered rap sheet (`lib/api.js`), `/rapsheet` (ephemeral), `/expunge` (Manage Server). Enforcement's four commands file records through `records/lib/api.js`, wrapped so records trouble never blocks an action. `data/` gitignored. Manual `records.md`.


- **Build system (M0):** the `run-skill-generator` skill (0.2.1 — SKILL.md, 4 references, CHANGELOG, LEARNINGS, evals with graded expectations) plus `CLAUDE.md`, this file, `SESSION_LOG.md`, `ROADMAP.md`, `docs/README.md`, `.gitignore`, root `README.md`.
- **Bot core (M1):** entry/config/logger/loader (+ in-code `.env` loading via `src/core/env.js` — see the S6 environment fact), guild-scoped `deploy-commands`, module `core` (`/radio-check`, on-duty sweep, guild lockdown), `npm run doctor` (S5), `config.json → homeGuildId`, manual `core.md`.
- **Enforcement (M2, S7; animated S10):** module `enforcement` — `/cite` (Papers-Please-style generated ticket PNG + DM copy; pure-JS renderer: pixel font → citation card → zero-dependency PNG encoder), `/detain` (duration parsing incl. compounds, 28-day cap), `/release` (timeout or ban, permission-tiered), `/arrest` (ban by member or id, wipe choices). Shared guards; audit reasons embed the officer; manual `enforcement.md`. **S10:** `/cite` emits an animated GIF (prints out of a slot) via a zero-dependency GIF89a encoder (`lib/gif.js`); added the public for-fun `/fine` (no perms, no records).
- **Deployment/ops (M8 slices):** `scripts/setup-pi.sh` (8 steps incl. invite gate and self-update arming), `scripts/update.sh` (fetch → ff → npm install → **test gate** → deploy-commands → restart; rollback on red — proven in a clone-pair simulation incl. failure path and exit codes), runbook `docs/operations/raspberry-pi.md`.
- **Product decisions:** single-guild bot (home precinct `411157175948541954`); citations rendered as tickets (owner request, concept credit in the manual); bot self-updates from `main` every 15 min, test-gated; **CuffBot's XP replaces the old leveler bot** and **existing members' XP is seeded from their current rank role** (S16); AI (M9) uses a free-tier provider with a GLOBAL rate limit — 1 msg / 7 s AND max 62 msgs / hour, shared across all users (S16).
- **Tests:** 254 via `node:test` — config, env loader, loader integrity, core lib, diagnostics, prefix parse/adapter (incl. role resolution, min/max bounds, channel types), help, enforcement lib + GIF, academy ladder + commands (incl. XP coupling), dispatch, patrol screen/event/commands, leveling (pure math, seeding + self-heal, pinned-ladder gates, race guard, service, commands, both events), detective (limiter edges, prompt limits, both providers via fake fetch, pipeline branches, mention gates — **no network, ambient AI keys deleted at suite start**), and command smokes with fake interactions.

## Resume point

**M1–M9 complete: 9 modules, 29 commands, 254 tests, dual invocation, self-update, audited.**

⚠️ **Owner actions pending:**
1. Leveling: run `/rank-setup header:@[LEVELER]` once (pin) — auto-rank and XP seeding stay idle until then.
2. Detective: put `GROQ_API_KEY` (or `GEMINI_API_KEY`) in the Pi's `.env` and restart — AI replies "not configured" until then (`docs/modules/detective.md` § Owner setup).

Next: **M10 — Birthdays** (first unchecked milestone), or the owner's pick from the backlog (trivia, fallen tracker with the given RSS feeds + role ids, starboard, goal tracker, chat starter — all buildable without external decisions).


## Open problems / blockers

- **Owner live-verification pending:** M1 checklist (radio-check) and M2 checklist (enforcement manual → Testing) not yet confirmed on the live server. Bot needs *Moderate Members* + *Ban Members* granted and its role positioned above target roles.
- Auto-update timer arming requires the owner to re-run `scripts/setup-pi.sh` once (it appeared in S7).

## Environment facts (verified Session 0–7 · 2026-07-23)

- Node v22.22.2 here; npm registry reachable through the proxy. **Owner's Pi runs Node < 20.6** (S6) — `.env` is loaded in code; never reintroduce version-gated runtime flags while `engines` says `>=18`.
- Owner's deployment: Raspberry Pi, repo private (PAT for clones; stored credentials required by the self-update timer — setup step 8 arranges it).
- Sessions run in an **ephemeral container** — push every session. No `gh` CLI; GitHub via MCP tools.
- **Owner process mandate (S3): sessions merge their own PRs** and reset the branch onto main afterwards.
- **Self-update chain (since S7):** merged PR → Pi timer picks it up within ~15 min → tests gate the restart. A broken merge cannot take the live bot down (rollback), but it silently stalls updates — check `journalctl -u cuffbot-update` when the owner reports staleness.
- Live Discord testing impossible here (no token, and this container's egress proxy intercepts discord.com — S5). Owner checklists in the manuals are the live layer.
- This container's outbound proxy returns 403 for discord.com API calls — never interpret that as a Discord-side verdict (S5).
- **Owner's rank roles (S12):** the home guild already has leveler-bot ranks under a `[LEVELER]` header, high→low, EXCEPT roles `428378130705809408` and `667116908876660778` (non-ranks). Academy adopts them live; owner must run `/rank-setup header:@[LEVELER]` then `/rank-exclude` those two ids. Cannot be verified from here (no live guild). **Leveling (S16) builds on this same ladder** — rank thresholds and XP seeding both derive from it, so `/rank-setup` must be correct before the XP system promotes anyone.

## Maintenance notes

Keep every section of this file; update the dates and the *verified* markers; move solved problems into the session log. The Verification block must always list commands that make sense for the current phase.
