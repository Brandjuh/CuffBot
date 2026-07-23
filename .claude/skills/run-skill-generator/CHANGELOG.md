# Skill Changelog — run-skill-generator

Every change to this skill (SKILL.md or anything under its directory) gets an entry here, newest first. Versioning: patch = clarification/fix, minor = new capability/section/promoted lesson, major = protocol change (owner approval required). Each entry cites its evidence — the session and observation that motivated it — so future sessions can judge whether a rule still earns its place.

## 0.1.1 — 2026-07-23 (Session 1)

- `architecture.md`: config conventions rewritten — secrets stay in `.env` (`DISCORD_TOKEN`, `CLIENT_ID`); the home guild moved from a `DEV_GUILD_ID` env var to committed `config.json → homeGuildId`. Added the "single-guild by design" convention: guild-scoped command registration only, jurisdiction lockdown in `core` (leave on foreign join + boot sweep), modules may assume home-precinct context but keep data keyed by guild id.
- Evidence: S1 — the owner fixed the product to exactly one guild (`411157175948541954`). A committed non-secret setting keeps owner and sessions on one truth; an env var would make every environment drift-prone. `DEV_GUILD_ID` was thereby obsolete, and following the old reference text would have rebuilt it.

## 0.1.0 — 2026-07-23 (Session 0)

- Initial version: session loop (Orient → Verify → Plan → Build → Document → Record → Improve), iron rules (English artifacts, verify-don't-assume, manual+tests required, push before stopping), Definition of Done, file map.
- References: `architecture.md` (discord.js v14 / Node 22 / ESM stack, module pattern, police-theme vocabulary), `module-manual-template.md`, `discord-reference.md`, `self-improvement.md`.
- Eval prompts in `evals/evals.json`: bootstrap session and continuation-with-drift.
- Evidence: created in Session 0 from the owner's brief — a self-improving skill that builds a police-themed Discord bot, everything in English, clear manuals per module, sessions that hand off seamlessly, and no unverified assumptions.
