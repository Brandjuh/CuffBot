---
name: run-skill-generator
description: Self-improving build system for CuffBot, the police-themed Discord bot. Run this skill FIRST for any work in the CuffBot repository — building bot modules or slash commands, writing or updating module manuals, fixing bugs, reviewing project status, planning milestones, or improving this skill itself. Always use it when the user wants to start, continue, resume, or pick up work in any phrasing ("continue", "next module", "where were we", "keep going", Dutch phrases like "ga verder" or "volgende stap"), even for small changes or questions — it loads the session protocol, the verified project state, and lessons from earlier sessions that keep every session consistent with the last.
---

# CuffBot Build System (run-skill-generator)

Current skill version: see `CHANGELOG.md` next to this file. If you change this skill, bump it there.

You are one session in a relay. Sessions before you built what exists; sessions after you will build on what you leave behind. Nothing survives between sessions except **the repository**: code, docs, state files, and this skill. Work so that the next session — which may be you, with no memory of today — can pick up in minutes, not hours.

Every session has two jobs, no exceptions:

1. **Move CuffBot forward** — the police-themed Discord bot this repo exists for.
2. **Leave the system better than you found it** — state files current, and this skill sharpened by whatever today taught you.

## Iron rules

1. **English only in artifacts.** All code, comments, docs, manuals, commit messages, state files, and this skill are written in English. Chat with the user in the user's language (the owner often writes Dutch), but never let that language leak into the repository.
2. **Verify, never assume.** `STATE.md` and `SESSION_LOG.md` are *claims* written by a previous session, not truth. Files get deleted, tests rot, environments change. Reality always wins over what a document says — check before you build on it (Step 2). The same standard applies to your own work: nothing is "done" until you ran it and watched it work.
3. **No module without a manual and tests.** A module that works but is undocumented or untested is unfinished (see Definition of Done).
4. **Push before you stop.** Sessions run in an ephemeral container: anything not committed and pushed is destroyed. Commit early; push at the end of every session at the latest.

## The session loop

Seven steps, in order. Do not skip Orient and Verify even for "quick" tasks — skipping them is exactly how sessions drift apart.

### 1. Orient

Read, in this order:

1. `STATE.md` (repo root) — snapshot: phase, what exists, open problems, the exact resume point.
2. `SESSION_LOG.md` — at least the most recent entry; read further back when the task touches older work.
3. `ROADMAP.md` — where today's work sits in the larger plan.
4. `LEARNINGS.md` (this skill's directory) — active lessons; each exists because something once went wrong.

### 2. Verify

Run the **Verification block** at the top of `STATE.md` — it lists exact commands. In addition:

- `git log --oneline -5` and `git status` — does history match what `SESSION_LOG.md` claims?
- Spot-check that files `STATE.md` says exist actually exist and contain what it claims.
- If tests exist, run them (`npm test`) before writing new code.

When reality and state disagree, **reality wins**: correct `STATE.md`, record the correction in your session log entry (what was claimed vs. what was true), and only then continue. This is not overhead — it is the mechanism that keeps the relay trustworthy.

### 3. Plan

- If `STATE.md` has a resume point, that is your default task.
- Otherwise take the next unchecked item in `ROADMAP.md`.
- An explicit user request overrides both — but still record in the session log how it relates to the roadmap.
- Scope the session to a chunk you can build, test, and document today. A half-finished feature with a precise resume point beats a "finished" one that was never run.

### 4. Build

Read `references/architecture.md` before writing bot code — it fixes the stack, directory layout, module pattern, and the police-theme vocabulary that keeps CuffBot coherent. The short version:

- Node.js ≥ 18, discord.js v14, ESM, tests with the built-in `node:test` runner.
- One module = one directory under `src/modules/<name>/` containing its commands, events, and logic.
- Secrets live in `.env` (never committed); keep `.env.example` current.
- Separate pure logic from Discord API calls so the logic is testable without a live bot.
- Syntax-check what you write (`node --check`) and run the tests you add.

### 5. Document

- Every new or changed module gets a manual at `docs/modules/<module>.md`, following `references/module-manual-template.md` **exactly**. Uniform manuals are what make them usable — a reader should know where to look before opening the file.
- Update `docs/README.md` (the manual index) when adding a module.
- Update the root `README.md` if setup or usage changed.

### 6. Record

- Update `STATE.md`: phase, verified inventory, environment facts, open problems, and an **exact resume point** (file, next action, first command to run). Keep its Verification block runnable and current.
- Append — never rewrite — an entry to `SESSION_LOG.md` using the template inside that file: session number, date, goal, what was done (with commit hashes), decisions and why, corrections found in Step 2, handoff notes for the next session.
- **Owner decisions stated in chat go into the repo the moment they land** (a STATE.md fact plus a log line — config if it is a product setting). Chat does not survive sessions; the repo does. (Promoted from LEARNINGS after S1–S3 confirmations.)

### 7. Improve — the self-improving part

Run the retrospective in `references/self-improvement.md`. In short:

- Ask what slowed you down, misled you, or was missing this session.
- Turn each answer into the **smallest general fix** to this skill (SKILL.md or a reference), or record it as a candidate in `LEARNINGS.md` if it is not yet proven.
- Every skill edit: bump the version and add a `CHANGELOG.md` entry citing the session evidence.
- Guardrails: never weaken the iron rules or remove loop steps; prefer explaining why over adding rigid MUSTs; keep this file under ~300 lines by pushing detail into references.
- Finding nothing to improve is suspicious. If truly nothing, write one line in the session log saying so and why.

Then ship: commit with a clear message, push, open the pull request — and **merge it yourself** once its checks (if any) pass. The owner mandated self-merge in Session 3 ("voortaan zelf mergen"); do not leave PRs waiting for them. After merging, reset the working branch onto the updated default branch so the next session starts clean. If the skill itself misled you **mid-session**, do not wait for Step 7 — fix it on the spot and note it in the log.

## Definition of Done — per module

A module counts as done only when every box is checked. Check them explicitly in your session log entry:

- [ ] Code follows the `references/architecture.md` layout and passes `node --check` on every file
- [ ] Pure logic is covered by tests that pass via `npm test`
- [ ] Manual exists at `docs/modules/<module>.md`, follows the template, and matches actual behavior
- [ ] Module is listed in `docs/README.md`
- [ ] `STATE.md` and `SESSION_LOG.md` reflect the new reality

## File map

| Path | What it is | Touched in |
|---|---|---|
| `STATE.md` | Live snapshot + verification block + resume point | Step 2 (verify), Step 6 (update) |
| `SESSION_LOG.md` | Append-only session journal | Step 6 |
| `ROADMAP.md` | Milestones with acceptance criteria | Step 3; edit when scope changes |
| `docs/modules/*.md` | Per-module manuals (template-based) | Step 5 |
| `docs/README.md` | Manual index | Step 5 |
| `src/` | Bot source (layout in architecture.md) | Step 4 |
| `.claude/skills/run-skill-generator/` | This skill: protocol, references, changelog, evals | Step 7 |
| `LEARNINGS.md` (skill dir) | Candidate lessons awaiting promotion | Step 7 |

## References — read when needed

- `references/architecture.md` — before writing any bot code: stack, layout, module pattern, theme vocabulary, storage, error handling.
- `references/module-manual-template.md` — when writing or updating a manual: copy it, fill in every section.
- `references/discord-reference.md` — discord.js v14 essentials and known pitfalls (intents, command registration, interaction timeouts, moderation APIs). When behavior contradicts it, trust reality, then update it.
- `references/self-improvement.md` — at Step 7 of every session, and immediately when the skill misleads you mid-session.
- `evals/evals.json` — this skill's own test prompts. Extend them when the project grows new kinds of work; re-run them after big skill changes.
