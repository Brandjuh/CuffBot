# CuffBot — Project State

> Written by the latest session. These are **claims, not truth** — run the Verification block below before building on anything here. If reality disagrees with this file, reality wins: fix this file and record the correction in `SESSION_LOG.md`.

**Last updated:** Session 11 · 2026-07-23
**Phase:** M4 (dispatch / evidence locker) complete → next up is M5 (academy / ranks)

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
| Tests green | `npm test` | 98/98 pass as of S11 |
| Discovery smoke | `node -e "import('./src/core/loader.js').then(async m => console.log((await m.discoverModules()).map(x => x.name)))"` | `[ 'core', 'dispatch', 'enforcement', 'records' ]` |
| Manuals current | `ls docs/modules/` | `core.md`, `dispatch.md`, `enforcement.md`, `records.md` |
| Data gitignored | `git check-ignore data/x.json` | Prints the path (member history never committed) |
| Boot guard | `node src/index.js` (without `.env`) | Fails fast naming the missing env vars |
| Scripts sane | `bash -n scripts/setup-pi.sh scripts/update.sh` | No output |

## What exists (verified Session 11 · 2026-07-23)

- **Dual invocation (S9):** every command runs as `/x` AND `!x` (`src/core/prefix/` — parser, adapter, router; ephemeral→DM). `/help` (generated roster) and `/update` (manual, admin-only, test-gated) added to core. Message Content intent enabled with graceful slash-only fallback (`client.messageContentAvailable`); `config.json → prefix`. Text commands + patrol need that intent (portal enablement).
- **Dispatch (M4, S11):** module `dispatch` — the **evidence locker** (`/evidence-locker` set/status/clear, per-guild channel via store) receives a typed embed for every enforcement action; `/dispatch` broadcasts announcements. `lib/format.js` (pure embeds) + `lib/api.js` (`logEnforcement`, best-effort). Enforcement's four commands log to the locker via the cross-module seam, wrapped so it never blocks an action. Animation: `/cite` GIF now prints **bottom-to-top** (owner preference, S11). Manual `dispatch.md`.
- **Records (M3, S8):** `src/core/store.js` (atomic per-guild JSON, corrupt-file recovery, `CUFFBOT_DATA_DIR` override) + module `records` — case-numbered rap sheet (`lib/api.js`), `/rapsheet` (ephemeral), `/expunge` (Manage Server). Enforcement's four commands file records through `records/lib/api.js`, wrapped so records trouble never blocks an action. `data/` gitignored. Manual `records.md`.


- **Build system (M0):** the `run-skill-generator` skill (0.2.1 — SKILL.md, 4 references, CHANGELOG, LEARNINGS, evals with graded expectations) plus `CLAUDE.md`, this file, `SESSION_LOG.md`, `ROADMAP.md`, `docs/README.md`, `.gitignore`, root `README.md`.
- **Bot core (M1):** entry/config/logger/loader (+ in-code `.env` loading via `src/core/env.js` — see the S6 environment fact), guild-scoped `deploy-commands`, module `core` (`/radio-check`, on-duty sweep, guild lockdown), `npm run doctor` (S5), `config.json → homeGuildId`, manual `core.md`.
- **Enforcement (M2, S7; animated S10):** module `enforcement` — `/cite` (Papers-Please-style generated ticket PNG + DM copy; pure-JS renderer: pixel font → citation card → zero-dependency PNG encoder), `/detain` (duration parsing incl. compounds, 28-day cap), `/release` (timeout or ban, permission-tiered), `/arrest` (ban by member or id, wipe choices). Shared guards; audit reasons embed the officer; manual `enforcement.md`. **S10:** `/cite` emits an animated GIF (prints out of a slot) via a zero-dependency GIF89a encoder (`lib/gif.js`); added the public for-fun `/fine` (no perms, no records).
- **Deployment/ops (M8 slices):** `scripts/setup-pi.sh` (8 steps incl. invite gate and self-update arming), `scripts/update.sh` (fetch → ff → npm install → **test gate** → deploy-commands → restart; rollback on red — proven in a clone-pair simulation incl. failure path and exit codes), runbook `docs/operations/raspberry-pi.md`.
- **Product decisions:** single-guild bot (home precinct `411157175948541954`); citations rendered as tickets (owner request, concept credit in the manual); bot self-updates from `main` every 15 min, test-gated.
- **Tests:** 98 via `node:test` — config, env loader, loader integrity, core lib, diagnostics, prefix parse/adapter, help, enforcement lib (duration/audit/wrap), PNG + animated GIF structure/determinism, enforcement + records + dispatch command smokes with fake interactions.

## Resume point

**Session 12 → Milestone M5: academy / ranks.**

1. A design spec exists from the S-workflow (academy): rank ladder Cadet→Chief mapped to guild roles by name with admin overrides in the store; pure ladder logic in `lib/` (current rank, next/prev, plan add/remove roles, validate ladder); `/promote`, `/demote`, `/ranks`, `/ranks link|unlink`.
2. Read `discord-reference.md → Permissions` (role hierarchy: `role.editable`) and `architecture.md → Police theme vocabulary` (ranks) first.
3. Pure ladder logic with tests; hierarchy safety (bot must be able to manage the target roles); misconfigured/missing roles reported specifically.
4. Manual `docs/modules/academy.md`; update `docs/README.md`.
5. Note: `/badge` (M7) will read the current rank via academy's `lib/` — expose a reusable `currentRank(member roles, ladder)`.


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
