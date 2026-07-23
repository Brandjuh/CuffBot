# CuffBot — Project State

> Written by the latest session. These are **claims, not truth** — run the Verification block below before building on anything here. If reality disagrees with this file, reality wins: fix this file and record the correction in `SESSION_LOG.md`.

**Last updated:** Session 0 · 2026-07-23
**Phase:** M0 (build system) complete → next up is M1 (bot core scaffold)

## Verification block — run this before trusting the rest

| Check | Command | Expected right now |
|---|---|---|
| History matches the log | `git log --oneline -5` | Commits match the latest `SESSION_LOG.md` entries |
| Clean tree | `git status --short` | Empty (or only your own new work) |
| Skill intact | `ls .claude/skills/run-skill-generator/references/` | `architecture.md`, `discord-reference.md`, `module-manual-template.md`, `self-improvement.md` |
| State files present | `ls STATE.md SESSION_LOG.md ROADMAP.md CLAUDE.md docs/README.md` | All exist |
| Runtime available | `node --version` | v18 or newer (v22 as of S0) |
| Bot source | `ls src/ 2>/dev/null` | **Does not exist yet** — first bot code lands in M1 |

Once `src/` exists, extend this block with `npm test` and a `node --check` sweep — keep it matching the current phase.

## What exists (verified Session 0 · 2026-07-23)

- **Build system (M0):** the `run-skill-generator` skill (`SKILL.md`, 4 references, `CHANGELOG.md` at 0.1.0, `LEARNINGS.md`, `evals/evals.json`), plus `CLAUDE.md`, `STATE.md`, `SESSION_LOG.md`, `ROADMAP.md`, `docs/README.md` (empty manual index), `.gitignore`, root `README.md`.
- **No bot source yet.** `src/`, `package.json`, and `test/` do not exist — creating them is Milestone M1.

## Resume point

**Session 1 → Milestone M1: scaffold the bot core.**

1. Read `.claude/skills/run-skill-generator/references/architecture.md` (stack, layout, module pattern).
2. Create `package.json` (ESM, scripts: `start`, `test`, `deploy-commands`), install `discord.js`.
3. Build `src/index.js`, `src/core/{config,logger,loader}.js`, `src/deploy-commands.js`, and the `core` module with `/radio-check`.
4. Add `test/` (loader smoke test + any lib logic), `.env.example`, and the `docs/modules/core.md` manual.
5. Acceptance criteria: see `ROADMAP.md` → M1.

## Open problems / blockers

- None.

## Environment facts (verified Session 0 · 2026-07-23)

- Node v22.22.2, npm 10.9.7. npm registry reachable through the outbound proxy (`npm view discord.js version` → 14.27.0).
- Python 3.11.15 available (used by skill tooling, not by the bot).
- Sessions run in an **ephemeral container** — unpushed work is destroyed. Push every session.
- No `gh` CLI; GitHub operations go through the GitHub MCP tools.
- Live Discord testing is impossible from this environment (no token in the repo — by design). Build confidence in layers per `architecture.md → Verification habits`; give the owner a manual test checklist in each module manual.

## Maintenance notes

Keep every section of this file; update the dates and the *verified* markers; move solved problems into the session log. The Verification block must always list commands that make sense for the current phase.
