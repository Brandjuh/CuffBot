# CuffBot — Project State

> Written by the latest session. These are **claims, not truth** — run the Verification block below before building on anything here. If reality disagrees with this file, reality wins: fix this file and record the correction in `SESSION_LOG.md`.

**Last updated:** Session 6 · 2026-07-23
**Phase:** M1 (bot core) complete, Pi deployment script shipped early (part of M8) → next up is M2 (enforcement)

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
| Tests green | `npm test` | 20/20 pass as of S6 |
| Discovery smoke | `node -e "import('./src/core/loader.js').then(async m => console.log((await m.discoverModules()).map(x => x.name)))"` | `[ 'core' ]` |
| Manuals current | `ls docs/modules/` | `core.md` |
| Boot guard | `node src/index.js` (without `.env`) | Fails fast naming the missing env vars |

## What exists (verified Session 1 · 2026-07-23)

- **Build system (M0):** the `run-skill-generator` skill (SKILL.md, 4 references, CHANGELOG, LEARNINGS, evals with graded expectations) plus `CLAUDE.md`, this file, `SESSION_LOG.md`, `ROADMAP.md`, `docs/README.md`, `.gitignore`, root `README.md`. Skill loads and is invocable as `/run-skill-generator` (confirmed in-session S1).
- **Bot core (M1):** `package.json` (ESM, discord.js ^14.27.0 installed, scripts `start`/`test`/`deploy-commands`), `src/index.js` (fail-fast config, interaction router with themed error handling), `src/core/{config,logger,loader}.js`, `src/deploy-commands.js` (guild-scoped registration), module `core` (`/radio-check`, on-duty sweep, guild lockdown, pure `lib/` logic), `test/` 11 tests green, `.env.example`, `config.json` with `homeGuildId`, manual `docs/modules/core.md`, README Quickstart.
- **Product decision:** CuffBot is a **single-guild bot**. Home precinct: `411157175948541954` (`config.json → homeGuildId`). The bot leaves any other guild (live join + boot sweep).
- **Deployment (S2, pulled forward from M8):** `scripts/setup-pi.sh` — idempotent Raspberry Pi installer (NodeSource Node 22, clone/update, `.env` prompt, tests, guild-scoped command registration, systemd service `cuffbot`) + runbook `docs/operations/raspberry-pi.md`. Verified with `bash -n` and review only — **not yet run on real Pi hardware**; owner is the first live test.
- **Deployment target (owner fact, S2):** a Raspberry Pi. Repo is **private** → cloning from the Pi needs a GitHub Personal Access Token (documented in the runbook).
- **Not yet possible here:** live Discord login (owner holds the token). Owner-facing steps live in README → Quickstart and the manual's live-test checklist.

## Resume point

**Session 2 → Milestone M2: enforcement module.**

1. Read `.claude/skills/run-skill-generator/references/architecture.md` and `discord-reference.md → Moderation APIs` first.
2. Create `src/modules/enforcement/` with `/cite` (warn) first, then `/detain` (timeout + duration option), `/release`, `/arrest` (ban) — per `ROADMAP.md → M2` acceptance criteria.
3. Duration parsing in `src/modules/enforcement/lib/duration.js` with tests (`10m`, `2h`, `7d`, invalid input, 28-day timeout cap).
4. Hierarchy/permission checks per `discord-reference.md` (check both invoker permission and bot ability; reply honestly when blocked).
5. Manual at `docs/modules/enforcement.md`; update `docs/README.md` index.
6. Note: infraction *storage* is M3 (records) — M2 acts via Discord + audit-log reasons only.

## Open problems / blockers

- Owner-side setup pending: fill `.env`, invite the bot to the home precinct, run `npm run deploy-commands`, `npm start` (README → Quickstart). Until then no live verification of `/radio-check` — automated layers are green.

## Environment facts (verified Session 0–1 · 2026-07-23)

- Node v22.22.2, npm 10.9.7. npm registry reachable through the outbound proxy; `npm install` works (S1: 25 packages in ~8 s).
- **Owner's Pi runs Node < 20.6** (S6: `--env-file` rejected). The repo therefore loads `.env` in code (`src/core/env.js`) — never reintroduce version-gated runtime flags while `engines` says `>=18`.
- Python 3.11.15 available (used by skill tooling, not by the bot).
- Sessions run in an **ephemeral container** — unpushed work is destroyed. Push every session.
- No `gh` CLI; GitHub operations go through the GitHub MCP tools. PR #1 (M0+M1+Pi script) was merged by the owner on 2026-07-23.
- **Owner process mandate (S3): sessions merge their own PRs** once checks pass — do not wait for the owner. After merging, reset the working branch onto the updated default branch. (Also encoded in SKILL.md Step 7.)
- Live Discord testing is impossible from this environment (no token in the repo — by design). Build confidence in layers per `architecture.md → Verification habits`; give the owner a manual test checklist in each module manual.

## Maintenance notes

Keep every section of this file; update the dates and the *verified* markers; move solved problems into the session log. The Verification block must always list commands that make sense for the current phase.
