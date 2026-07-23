# CuffBot 🚔

A police-themed Discord bot for running your server like a well-loved precinct: moderation as *citations* and *arrests*, a *rap sheet* for infractions, *dispatch* announcements, an *evidence locker* log channel, rank ladders from Cadet to Chief, and a little community fun (`/wanted`, `/donut`).

**Status:** pre-release — the build system (M0) is in place; the bot core (M1) is next. Current truth lives in [`STATE.md`](STATE.md), the plan in [`ROADMAP.md`](ROADMAP.md).

## How this repo is built

CuffBot is developed session-by-session by Claude using a **self-improving build skill** in [`.claude/skills/run-skill-generator/`](.claude/skills/run-skill-generator/SKILL.md). Every session follows the same loop — orient on state, *verify it against reality*, build, document, record, and improve the skill itself — so sessions hand off seamlessly and the system gets sharper as the project grows.

- [`CLAUDE.md`](CLAUDE.md) — entry point that routes every session into the skill
- [`STATE.md`](STATE.md) — live snapshot + resume point (with a verification block)
- [`SESSION_LOG.md`](SESSION_LOG.md) — append-only journal of every session
- [`ROADMAP.md`](ROADMAP.md) — milestones with acceptance criteria
- [`docs/`](docs/README.md) — one manual per bot module (mandatory)

Everything in this repository — code, docs, commits — is written in English.

## Quickstart

Arrives with Milestone M1 (bot core). Until then there is nothing to run yet — see the roadmap.

## Planned stack

Node.js ≥ 18 · discord.js v14 · ESM · `node:test` · JSON storage (SQLite-ready seam). Rationale in [`architecture.md`](.claude/skills/run-skill-generator/references/architecture.md).
