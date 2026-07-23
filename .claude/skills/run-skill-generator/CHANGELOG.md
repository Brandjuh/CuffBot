# Skill Changelog — run-skill-generator

Every change to this skill (SKILL.md or anything under its directory) gets an entry here, newest first. Versioning: patch = clarification/fix, minor = new capability/section/promoted lesson, major = protocol change (owner approval required). Each entry cites its evidence — the session and observation that motivated it — so future sessions can judge whether a rule still earns its place.

## 0.3.1 — 2026-07-23 (Session 9)

- `discord-reference.md`: documented the graceful privileged-intent fallback pattern (try-with, catch 4014/"disallowed intents", retry-without, gate features on a flag) so a self-updating bot can add a privileged intent without risking a crash-loop; plus the GuildMessages + MessageContent split for text-command invocation.
- Evidence: S9 added `!command` text invocation (needs the privileged Message Content intent) to a bot the owner runs under a restart-on-failure systemd unit; a naive intent addition would have crash-looped their live bot.

## 0.3.0 — 2026-07-23 (Session 8)

- `architecture.md`: documented the implemented storage layer (`store.js` API, atomic writes, corrupt-file recovery, `CUFFBOT_DATA_DIR`) and added the **Cross-module calls** convention (call the target's `lib/` API directly, wrap in try/catch, never block the primary action).
- Evidence: S8 built the first stateful module (records) and the first inter-module dependency (enforcement → records); both needed conventions that did not exist yet.

## 0.2.1 — 2026-07-23 (Session 7)

- `LEARNINGS.md`: recorded the S6 candidates that S6's session log had claimed but never wrote (correction logged in S7's entry), plus two new S7 candidates: rendered assets need visual verification; unattended mechanisms need a simulated dress rehearsal of their failure path.
- Evidence: S7 — the drift was caught while re-reading LEARNINGS during the retrospective; the two new lessons come from the citation-ticket render check and the self-updater clone-pair simulation.

## 0.2.0 — 2026-07-23 (Session 3)

- `SKILL.md` Step 7 (Ship): sessions now open **and merge** their own pull requests once checks pass, then reset the working branch onto the updated default branch. Evidence: owner mandate in Session 3 — "Ik heb de merge nu gedaan, maar doe dat in het vervolg zelf" (I merged it this time, from now on do it yourself).
- `SKILL.md` Step 6: promoted the LEARNINGS candidate "owner decisions stated in chat go into the repo the moment they land" after three confirmations (S1 single-guild requirement, S2 Raspberry Pi target, S3 self-merge mandate).

## 0.1.1 — 2026-07-23 (Session 1)

- `architecture.md`: config conventions rewritten — secrets stay in `.env` (`DISCORD_TOKEN`, `CLIENT_ID`); the home guild moved from a `DEV_GUILD_ID` env var to committed `config.json → homeGuildId`. Added the "single-guild by design" convention: guild-scoped command registration only, jurisdiction lockdown in `core` (leave on foreign join + boot sweep), modules may assume home-precinct context but keep data keyed by guild id.
- Evidence: S1 — the owner fixed the product to exactly one guild (`411157175948541954`). A committed non-secret setting keeps owner and sessions on one truth; an env var would make every environment drift-prone. `DEV_GUILD_ID` was thereby obsolete, and following the old reference text would have rebuilt it.

## 0.1.0 — 2026-07-23 (Session 0)

- Initial version: session loop (Orient → Verify → Plan → Build → Document → Record → Improve), iron rules (English artifacts, verify-don't-assume, manual+tests required, push before stopping), Definition of Done, file map.
- References: `architecture.md` (discord.js v14 / Node 22 / ESM stack, module pattern, police-theme vocabulary), `module-manual-template.md`, `discord-reference.md`, `self-improvement.md`.
- Eval prompts in `evals/evals.json`: bootstrap session and continuation-with-drift.
- Evidence: created in Session 0 from the owner's brief — a self-improving skill that builds a police-themed Discord bot, everything in English, clear manuals per module, sessions that hand off seamlessly, and no unverified assumptions.
