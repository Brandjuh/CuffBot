# Skill Changelog — run-skill-generator

Every change to this skill (SKILL.md or anything under its directory) gets an entry here, newest first. Versioning: patch = clarification/fix, minor = new capability/section/promoted lesson, major = protocol change (owner approval required). Each entry cites its evidence — the session and observation that motivated it — so future sessions can judge whether a rule still earns its place.

## 0.4.1 — 2026-07-23 (Session 16)

- `discord-reference.md` → Client & intents: two S16 facts — (a) event-only features (message XP) need just `GuildMessages`, never `MessageContent`; design them to survive the privileged-intent fallback; (b) `GuildVoiceStates` is non-privileged and voice presence is cache-only (no REST listing).
- `LEARNINGS.md`: three new candidates — post-compaction file memory is stale (Read before Edit after a handoff); write-avoidance on SD-card deployments (read-only fast paths + batched tick writes); automation needs a stronger trust gate than human-in-the-loop commands (require an admin-pinned anchor; make automated writes self-healing).
- Evidence: S16 built the leveling module — one Edit failed against remembered-but-stale file text; the first draft's per-message/per-member store writes were needless Pi flash wear; and the S16 audit's HIGH finding was exactly the reused-heuristic-without-a-pin failure (decoy ladder → auto role grants + permanently poisoned 0-seeds). The audit-before-done rule (0.4.0) caught it pre-merge for the second consecutive time.

## 0.4.0 — 2026-07-23 (Session 15)

- `self-improvement.md`: added "Before declaring a milestone or the base done: adversarially audit" — an independent, verified cross-dimension review is now part of the protocol, because author-written tests share the author's blind spots.
- `LEARNINGS.md`: promoted two candidates confirmed repeatedly across sessions — (a) the cross-module seam convention (call a target module's `lib/` API wrapped in try/catch; ~6 consumers held up), already in `architecture.md`; (b) "the owner's reality overrides the generic design" (S1 single-guild, S12 leveler ranks, S15 VC-time request).
- Evidence: S15 final audit found a HIGH-severity parser bug (multi-word `!cite`/`!fine` reasons silently truncated into `penalty` and filed into permanent records; `!arrest`/`!911` reasons rejected) that 150+ passing tests missed. Fixed via per-command `textGreedyArg` + tail-binding of trailing options; plus mention-injection hardening, loader event validation, channel-aware prefix permissions, and doc corrections.

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
