# CuffBot — Session Log

Append-only journal of work sessions, oldest first — **never rewrite or delete past entries**; they are the project's memory. Each session appends one entry at the bottom using this template:

```markdown
## Session <N> — <YYYY-MM-DD>

**Goal:** what this session set out to do, and why (roadmap item / user request / resume point).
**Done:** what actually got finished, with commit hashes.
**Decisions:** choices made and the reasoning — future sessions should not have to re-litigate them.
**Corrections:** drift found in Step 2 (claimed vs. actual), or `None — state matched reality.`
**Learned:** surprises worth remembering (also mirrored into skill LEARNINGS/references when general).
**Skill:** what changed in the skill this session (version), or why nothing needed to.
**Handoff:** exact next steps for Session <N+1> — mirror the essentials into STATE.md's resume point.
```

---

## Session 0 — 2026-07-23

**Goal:** Bootstrap the project from an empty repo, per the owner's brief: a **self-improving skill** that builds CuffBot, a police-themed Discord bot; everything in English; clear manuals per module; sessions that hand off seamlessly; verify instead of assume.

**Done:**
- Built the `run-skill-generator` skill v0.1.0: session loop (Orient → Verify → Plan → Build → Document → Record → Improve), iron rules, Definition of Done, references (`architecture.md`, `module-manual-template.md`, `discord-reference.md`, `self-improvement.md`), `CHANGELOG.md`, `LEARNINGS.md`, eval prompts.
- Built the state system: `CLAUDE.md`, `STATE.md` (with Verification block), this log, `ROADMAP.md` (M1–M8), `docs/README.md` manual index, `.gitignore`, root `README.md`.
- Validated the skill with isolated eval runs (bootstrap session and continuation-with-drift, each with and without the skill, graded against objective assertions); any findings are folded back into the skill — post-0.1.0 entries in its `CHANGELOG.md` carry the evidence.
- Commits: see `git log` for this session's history on the feature branch.

**Decisions:**
- Stack: discord.js v14 on Node 22, ESM, `node:test`, JSON storage first — see `architecture.md` for rationale. Environment verified, not assumed (Node v22.22.2 present; npm registry reachable, discord.js 14.27.0).
- Skill lives in-repo (`.claude/skills/`) so it travels with the code and every session gets it automatically via `CLAUDE.md`.
- Lessons flow through a two-stage pipeline (LEARNINGS candidates → promoted into the skill after second confirmation) to keep the skill lean.

**Corrections:** None — first session, nothing to drift from.

**Learned:** Environment facts recorded in `STATE.md` (npm works through proxy; ephemeral container; no `gh` CLI).

**Skill:** Created at 0.1.0; post-eval improvements recorded in its `CHANGELOG.md`.

**Handoff:** Session 1 picks up `STATE.md → Resume point`: Milestone M1, scaffold the bot core (package.json, entry, config/logger/loader, `core` module with `/radio-check`, tests, `.env.example`, `docs/modules/core.md`). Read `architecture.md` first.

## Session 1 — 2026-07-23

**Goal:** Owner request: "make the base so we can connect" — the bot runs only in guild `411157175948541954`, name Cuffbot. This is exactly `STATE.md`'s resume point (M1: bot core), so no roadmap deviation.

**Done:**
- Bot core per `architecture.md`: `package.json` (ESM, discord.js ^14.27.0), `src/index.js` (fail-fast config, interaction router, themed error handler), `src/core/{config,logger,loader}.js`, `src/deploy-commands.js` (guild-scoped registration).
- Module `core`: `/radio-check` (latency verdict from pure `lib/radio.js`), `on-duty` ready-sweep, `guild-lockdown` — the single-precinct requirement implemented as a feature: `config.json → homeGuildId`, bot leaves any foreign guild (live join and boot sweep).
- Tests: 11/11 green (`config`, `loader` integrity incl. duplicate-name guard, pure lib logic). `node --check` clean on all of `src/` and `test/`.
- Verified without a token: fail-fast boot error names the missing env vars and points to the fix; module discovery smoke returns `core`.
- Docs: `docs/modules/core.md` (full template), `docs/README.md` index, README Quickstart (portal steps, invite URL, deploy, start). ROADMAP M1 ticked.
- Committed as one commit on the feature branch (see `git log`, Session 1).

**Decisions:**
- **Single-guild is a product decision, not a dev convenience.** `homeGuildId` lives in committed `config.json` (non-secret), replacing the earlier `DEV_GUILD_ID` env idea; commands register guild-scoped only, and the bot leaves foreign guilds. Rationale: owner stated the bot serves exactly one server; committed config keeps every session and the owner on the same truth.
- Permissions in the invite URL kept to a minimal `Send Messages` baseline; privileged intents deliberately not requested yet.

**Corrections:** None — Step 2 verification matched `STATE.md` (clean tree, no `src/`, Node v22).

**Learned:** Live login cannot be verified from this environment; the honest maximum is layered verification (syntax → tests → discovery → fail-fast boot) plus an owner checklist in the manual — recorded as the standard in `architecture.md → Verification habits`.

**Skill:** Updated to 0.1.1 — `architecture.md` config conventions now describe `config.json → homeGuildId` and the single-guild lockdown pattern (evidence: this session's owner requirement made `DEV_GUILD_ID` obsolete). Candidates added to `LEARNINGS.md`.

**Handoff:** Owner: follow README → Quickstart (fill `.env`, invite via the URL, `npm run deploy-commands`, `npm start`), then run the live checklist in `docs/modules/core.md → Testing`. Next build session: Session 2 → M2 (enforcement) per `STATE.md → Resume point`.

## Session 2 — 2026-07-23

**Goal:** Owner request: one command that installs everything on their Raspberry Pi. Relates to the roadmap as an early slice of M8 (deployment & operations) — pulled forward on owner priority; M8 stays open for the rest (global deploy N/A, backups, rotation runbook).

**Done:**
- `scripts/setup-pi.sh` — idempotent installer: apt basics, Node 22 LTS via NodeSource (skip if ≥18; clear abort on armv6), clone/update (uses the current clone when run from inside one), `npm install`, `.env` prompt (hidden token input, mode 600, never overwrites), `npm test` gate, guild-scoped command registration, optional systemd service `cuffbot` (autostart + restart-on-crash). Re-running is the update path.
- `docs/operations/raspberry-pi.md` — runbook: requirements (Pi 2+, PAT for the private repo), what the script does, day-to-day operations table, troubleshooting.
- README: "Run it on a Raspberry Pi" section with the one-liner.
- STATE updated (deployment target fact: Raspberry Pi; repo verified **private** via GitHub listing — clone needs a PAT).

**Decisions:**
- systemd over pm2/screen: no extra dependency, native on Pi OS, survives reboots.
- The script is the update mechanism (pull + re-register + restart) instead of a separate update script — one thing for the owner to remember.

**Corrections:** None — tree was clean at Session 1's commit.

**Learned:** Verification limit: the script is `bash -n`-checked and review-verified only; there is no Pi (or apt/systemd) in this environment. The owner's first run is the real test — the runbook's troubleshooting table is the safety net. Logged honestly here per iron rule 2.

**Skill:** No skill changes — the session surfaced no new general lesson beyond the deployment-target fact, which lives in STATE (a LEARNINGS candidate about recording owner platform facts already exists from S1; this is its second data point → eligible for promotion next session if it proves out again).

**Handoff:** Owner: run the one-liner from `docs/operations/raspberry-pi.md` (pin the feature branch until PR #1 merges). Next build session: Session 3 → M2 (enforcement) per `STATE.md → Resume point`.

## Session 3 — 2026-07-23

**Goal:** Encode the owner's new process mandate from chat: PR #1 was merged by the owner this one time; from now on sessions merge their own PRs.

**Done:**
- SKILL.md 0.2.0: Step 7 now ends with self-merge (open the PR, merge once checks pass, reset the branch onto the updated default); Step 6 gained the promoted rule "owner decisions stated in chat go into the repo the moment they land".
- LEARNINGS: the S1 candidate about chat-borne owner decisions promoted after three confirmations (S1 single-guild, S2 Pi target, S3 self-merge).
- STATE: owner process mandate recorded; PR #1 noted as merged by owner.
- This entry's own PR is the mandate's first application: pushed, opened, and self-merged.

**Decisions:** Applied the mandate immediately rather than bundling with the pending eval-results work — chat is the only place the mandate existed, and chat does not survive sessions (that is exactly the promoted rule).

**Corrections:** None — branch freshly reset onto merged main; tree clean.

**Learned:** Nothing new beyond the mandate itself.

**Skill:** 0.2.0 (see its CHANGELOG for evidence).

**Handoff:** Pending in-flight: four skill-eval runs (grading → benchmark → possible skill improvements land as a follow-up PR). Next build session: M2 (enforcement) per `STATE.md → Resume point`.
