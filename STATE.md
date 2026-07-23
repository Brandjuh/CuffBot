# CuffBot — Project State

> Written by the latest session. These are **claims, not truth** — run the Verification block below before building on anything here. If reality disagrees with this file, reality wins: fix this file and record the correction in `SESSION_LOG.md`.

**Last updated:** Session 8 · 2026-07-23
**Phase:** M3 (records) complete → next up is M4 (dispatch / evidence locker)

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
| Tests green | `npm test` | 60/60 pass as of S8 |
| Discovery smoke | `node -e "import('./src/core/loader.js').then(async m => console.log((await m.discoverModules()).map(x => x.name)))"` | `[ 'core', 'enforcement', 'records' ]` |
| Manuals current | `ls docs/modules/` | `core.md`, `enforcement.md`, `records.md` |
| Data gitignored | `git check-ignore data/x.json` | Prints the path (member history never committed) |
| Boot guard | `node src/index.js` (without `.env`) | Fails fast naming the missing env vars |
| Scripts sane | `bash -n scripts/setup-pi.sh scripts/update.sh` | No output |

## What exists (verified Session 8 · 2026-07-23)

- **Records (M3, S8):** `src/core/store.js` (atomic per-guild JSON, corrupt-file recovery, `CUFFBOT_DATA_DIR` override) + module `records` — case-numbered rap sheet (`lib/api.js`), `/rapsheet` (ephemeral), `/expunge` (Manage Server). Enforcement's four commands file records through `records/lib/api.js`, wrapped so records trouble never blocks an action. `data/` gitignored. Manual `records.md`.


- **Build system (M0):** the `run-skill-generator` skill (0.2.1 — SKILL.md, 4 references, CHANGELOG, LEARNINGS, evals with graded expectations) plus `CLAUDE.md`, this file, `SESSION_LOG.md`, `ROADMAP.md`, `docs/README.md`, `.gitignore`, root `README.md`.
- **Bot core (M1):** entry/config/logger/loader (+ in-code `.env` loading via `src/core/env.js` — see the S6 environment fact), guild-scoped `deploy-commands`, module `core` (`/radio-check`, on-duty sweep, guild lockdown), `npm run doctor` (S5), `config.json → homeGuildId`, manual `core.md`.
- **Enforcement (M2, S7):** module `enforcement` — `/cite` (Papers-Please-style generated ticket PNG + DM copy; pure-JS renderer: pixel font → citation card → zero-dependency PNG encoder), `/detain` (duration parsing incl. compounds, 28-day cap), `/release` (timeout or ban, permission-tiered), `/arrest` (ban by member or id, wipe choices). Shared guards; audit reasons embed the officer; manual `enforcement.md`.
- **Deployment/ops (M8 slices):** `scripts/setup-pi.sh` (8 steps incl. invite gate and self-update arming), `scripts/update.sh` (fetch → ff → npm install → **test gate** → deploy-commands → restart; rollback on red — proven in a clone-pair simulation incl. failure path and exit codes), runbook `docs/operations/raspberry-pi.md`.
- **Product decisions:** single-guild bot (home precinct `411157175948541954`); citations rendered as tickets (owner request, concept credit in the manual); bot self-updates from `main` every 15 min, test-gated.
- **Tests:** 46 via `node:test` — config, env loader, loader integrity, core lib, diagnostics, enforcement lib (duration/audit/wrap), PNG/card structure + determinism, enforcement command smokes with fake interactions.

## Resume point

**Session 9 → Milestone M4: dispatch / evidence locker.**

1. Read `architecture.md → Police theme vocabulary` (evidence locker = mod-log channel; dispatch = announcements) and the M4 acceptance criteria in `ROADMAP.md`.
2. Module `dispatch`: a configurable per-guild log channel (the *evidence locker*) that receives enforcement/records events, plus `/dispatch` for announcements to the force.
3. Store the channel id per guild via `src/core/store.js` (the seam already exists). Handle missing-channel and missing-permission cases with specific replies.
4. Wire enforcement/records → dispatch through a `dispatch/lib/` API, following the cross-module convention now documented in `architecture.md → Cross-module calls` (call the lib, wrap in try/catch, never block the primary action).
5. Manual `docs/modules/dispatch.md`; update `docs/README.md` index and the enforcement/records manuals where they now emit to the locker.

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

## Maintenance notes

Keep every section of this file; update the dates and the *verified* markers; move solved problems into the session log. The Verification block must always list commands that make sense for the current phase.
