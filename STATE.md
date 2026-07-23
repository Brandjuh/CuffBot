# CuffBot — Project State

> Written by the latest session. These are **claims, not truth** — run the Verification block below before building on anything here. If reality disagrees with this file, reality wins: fix this file and record the correction in `SESSION_LOG.md`.

**Last updated:** Session 14 · 2026-07-23
**Phase:** M7 (public affairs) complete — all feature modules M1–M7 done → next up is M8 finish + final audit

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
| Tests green | `npm test` | 143/143 pass as of S14 |
| Discovery smoke | `node -e "import('./src/core/loader.js').then(async m => console.log((await m.discoverModules()).map(x => x.name)))"` | `[ 'academy', 'core', 'dispatch', 'enforcement', 'patrol', 'public-affairs', 'records' ]` |
| Manuals current | `ls docs/modules/` | academy, core, dispatch, enforcement, patrol, public-affairs, records |
| Data gitignored | `git check-ignore data/x.json` | Prints the path (member history never committed) |
| Boot guard | `node src/index.js` (without `.env`) | Fails fast naming the missing env vars |
| Scripts sane | `bash -n scripts/setup-pi.sh scripts/update.sh` | No output |

## What exists (verified Session 14 · 2026-07-23)

- **Dual invocation (S9):** every command runs as `/x` AND `!x` (`src/core/prefix/` — parser, adapter, router; ephemeral→DM). `/help` (generated roster) and `/update` (manual, admin-only, test-gated) added to core. Message Content intent enabled with graceful slash-only fallback (`client.messageContentAvailable`); `config.json → prefix`. Text commands + patrol need that intent (portal enablement).
- **Public Affairs (M7, S14):** module `public-affairs` — `/badge` (rank via academy `currentRank`, record count via records `recordsFor`, join date; graceful fallbacks), `/wanted` (playful poster embed, deterministic crime/bounty), `/donut` (fun), `/911` (report to the evidence locker via dispatch `sendToEvidenceLocker`; **anonymity option**, ephemeral confirm). `lib/cards.js` pure. No privileged intents. Manual `public-affairs.md`.
- **Patrol (M6, S13):** module `patrol` — automod. `lib/screen.js` (pure) screens for banned terms (evasion-aware normalization: leet/spacing/diacritics → substring), invite links, and spam (mention flood / char runs). `MessageCreate` handler gated on `client.messageContentAvailable`, mod-exempt, home-guild only; on a hit deletes + DMs + files a record + logs to the evidence locker (cross-module seams). `/patrol` (on/off/status), `/patrol-rule`, `/patrol-term`. Off by default; config in store `patrolConfig`. False-positive story documented. Needs Message Content intent. Manual `patrol.md`.
- **Academy (M5, S12):** module `academy` — adopts the **server's own rank roles** (not a fixed police ladder). `lib/ladder.js` (pure) detects ranks from roles under a `[LEVELER]`-style header, highest-first, minus managed/@everyone/excluded, stopping at the next divider; `planPromotion`/`planDemotion` normalize to one rank role. `/promote`, `/demote` (to: role option), `/ranks`, `/rank-setup` (header), `/rank-exclude`. Config in store `academyConfig={headerRoleId,excludedRoleIds}`; ladder recomputed live. `currentRank` exported for /badge (M7). Manual `academy.md`.
- **Dispatch (M4, S11):** module `dispatch` — the **evidence locker** (`/evidence-locker` set/status/clear, per-guild channel via store) receives a typed embed for every enforcement action; `/dispatch` broadcasts announcements. `lib/format.js` (pure embeds) + `lib/api.js` (`logEnforcement`, best-effort). Enforcement's four commands log to the locker via the cross-module seam, wrapped so it never blocks an action. Animation: `/cite` GIF now prints **bottom-to-top** (owner preference, S11). Manual `dispatch.md`.
- **Records (M3, S8):** `src/core/store.js` (atomic per-guild JSON, corrupt-file recovery, `CUFFBOT_DATA_DIR` override) + module `records` — case-numbered rap sheet (`lib/api.js`), `/rapsheet` (ephemeral), `/expunge` (Manage Server). Enforcement's four commands file records through `records/lib/api.js`, wrapped so records trouble never blocks an action. `data/` gitignored. Manual `records.md`.


- **Build system (M0):** the `run-skill-generator` skill (0.2.1 — SKILL.md, 4 references, CHANGELOG, LEARNINGS, evals with graded expectations) plus `CLAUDE.md`, this file, `SESSION_LOG.md`, `ROADMAP.md`, `docs/README.md`, `.gitignore`, root `README.md`.
- **Bot core (M1):** entry/config/logger/loader (+ in-code `.env` loading via `src/core/env.js` — see the S6 environment fact), guild-scoped `deploy-commands`, module `core` (`/radio-check`, on-duty sweep, guild lockdown), `npm run doctor` (S5), `config.json → homeGuildId`, manual `core.md`.
- **Enforcement (M2, S7; animated S10):** module `enforcement` — `/cite` (Papers-Please-style generated ticket PNG + DM copy; pure-JS renderer: pixel font → citation card → zero-dependency PNG encoder), `/detain` (duration parsing incl. compounds, 28-day cap), `/release` (timeout or ban, permission-tiered), `/arrest` (ban by member or id, wipe choices). Shared guards; audit reasons embed the officer; manual `enforcement.md`. **S10:** `/cite` emits an animated GIF (prints out of a slot) via a zero-dependency GIF89a encoder (`lib/gif.js`); added the public for-fun `/fine` (no perms, no records).
- **Deployment/ops (M8 slices):** `scripts/setup-pi.sh` (8 steps incl. invite gate and self-update arming), `scripts/update.sh` (fetch → ff → npm install → **test gate** → deploy-commands → restart; rollback on red — proven in a clone-pair simulation incl. failure path and exit codes), runbook `docs/operations/raspberry-pi.md`.
- **Product decisions:** single-guild bot (home precinct `411157175948541954`); citations rendered as tickets (owner request, concept credit in the manual); bot self-updates from `main` every 15 min, test-gated.
- **Tests:** 143 via `node:test` — config, env loader, loader integrity, core lib, diagnostics, prefix parse/adapter (incl. role resolution), help, enforcement lib + GIF, academy ladder + commands, dispatch, patrol screen/event/commands, and command smokes with fake interactions.

## Resume point

**Session 15 → M8 finish + final adversarial audit.**

1. M8 remainder: `data/` backup note (now that records/store exist), token-rotation runbook polish, a troubleshooting-FAQ sweep across manuals. Verify the ops runbook against `discord-reference.md → Token hygiene`.
2. Run a final **audit workflow** (adversarial review across the whole codebase: correctness, security, cross-module seams, theme/English consistency, doc/reality drift, test coverage). Verify findings; fix the real ones; log what was dropped.
3. Update the skill retrospective (promote any twice-confirmed LEARNINGS candidates), STATE, SESSION_LOG. Tick M8.
4. All feature modules (M1–M7) are complete: 7 modules, 24 commands, dual invocation, self-update. The base is done; M8 closes it out.


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
- **Owner's rank roles (S12):** the home guild already has leveler-bot ranks under a `[LEVELER]` header, high→low, EXCEPT roles `428378130705809408` and `667116908876660778` (non-ranks). Academy adopts them live; owner must run `/rank-setup header:@[LEVELER]` then `/rank-exclude` those two ids. Cannot be verified from here (no live guild).

## Maintenance notes

Keep every section of this file; update the dates and the *verified* markers; move solved problems into the session log. The Verification block must always list commands that make sense for the current phase.
