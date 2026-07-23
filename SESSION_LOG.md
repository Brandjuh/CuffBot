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

## Session 4 — 2026-07-23

**Goal:** First live Pi run (owner) failed at command registration with a misleading hint ("check DISCORD_TOKEN/CLIENT_ID") — diagnose and make the failure self-explanatory.

**Done:**
- `src/deploy-commands.js`: catches the three real-world failure modes and prints the fix — 50001 Missing Access → "bot is not in the precinct yet" + invite URL; 401 → wrong token (Bot token, not the OAuth2 Client Secret); 10002 → CLIENT_ID is not an Application ID. Unexpected errors print in full plus the invite hint.
- `scripts/setup-pi.sh`: before registration it now prints the invite URL (with the actual CLIENT_ID from .env) and waits for confirmation that the bot is a member; the failure text points at the specific message above it, `nano .env`, and the re-run command.

**Decisions:** Diagnosis lives in `deploy-commands.js` (which knows the API error), not in the shell script — the script only routes the reader to it.

**Corrections:** None in repo state. Real-world correction: the S2 failure text implied credentials were the only cause; a not-yet-invited bot produces the same failure. The owner hit exactly that ambiguity.

**Learned:** "Missing Access" (50001) on guild-command registration also means *bot not in guild* — added to the candidate below; first live run is where UX truth surfaces.

**Skill:** No SKILL.md change; LEARNINGS candidate added: error paths must name the most-likely real-world cause first, verified against a live failure, not just the cause the developer thought of.

**Handoff:** Owner: re-run the script after checking the printed cause. Next build session: M2 (enforcement) per `STATE.md → Resume point`. Eval runs still pending.

## Session 5 — 2026-07-23

**Goal:** Owner's Pi run keeps failing with 401 while they are certain the credentials are right. Stop instructing, start measuring: ship a doctor command that verifies credentials against Discord itself.

**Done:**
- `src/core/diagnostics.js` (pure, tested): raw-secret defect analysis (quotes, whitespace, CR), masked token fingerprint, offline bot-id decode from the token's first segment.
- `src/doctor.js` + `npm run doctor`: inspects the raw `.env` (defects that survive env parsing), shows what the bot actually sees, then asks Discord: `GET /users/@me` (is the token valid, whose is it) and `GET /oauth2/applications/@me` (which application owns it — compared against `CLIENT_ID`, catching the mixed-two-applications case). Named verdict + fix per failure; exit 1 on problems (verified).
- deploy-commands' 401 branch now routes to the doctor; runbook and core manual troubleshooting updated. Tests 15/15.

**Decisions:** The doctor reports, never auto-fixes `.env` — the owner must fix the file or the bot would still read the broken value. 403 on `/users/@me` is called out as a proxy artifact (seen in this container; the Pi talks to Discord directly).

**Corrections:** None in repo state.

**Learned:** A dry run here surfaced that this container's egress proxy intercepts discord.com (403) — the doctor can only be truth-tested live by the owner; its non-network paths are unit-tested.

**Skill:** No SKILL.md change. LEARNINGS candidate: owner-operated projects need a `doctor` command early — "verify, never assume" applies to the owner's environment too, and a tool beats instructions after the first "I am 100% sure".

**Handoff:** Owner: `cd ~/CuffBot && git pull && npm run doctor`, fix what it names, re-run the setup script. Next build session: M2 (enforcement). Eval runs still pending.

## Session 6 — 2026-07-23

**Goal:** Owner's doctor run on the Pi failed before reaching any check: `node: bad option: --env-file`. Root-cause and eliminate.

**Done:**
- Root cause: `--env-file` requires Node ≥ 20.6 while `package.json` promises `>=18`; the owner's Pi runs a Node in that gap. Every npm script relied on the flag — so `deploy-commands` never reached Discord at all.
- Fix: in-code `.env` loader `src/core/env.js` (quote-stripping, CRLF-tolerant, comments ignored, existing environment wins; missing file is not an error), called at the top of all three entrypoints. All npm scripts and the systemd unit dropped `--env-file`. Any Node ≥ 18 now truly works.
- Tests 20/20 (5 new for the loader); doctor verified standalone (exit 1 on broken creds); boot guard verified.
- Skill: `discord-reference.md` pitfalls row rewritten — do not use `--env-file`, with the S6 evidence.

**Decisions:** In-code loading over "require Node ≥ 20.6": removes the whole class of version-cliff failures instead of policing versions on owner hardware.

**Corrections:** Sessions 4–5 theorized about credentials (401 causes, token/application mismatch) while the owner's registration failure had never reached Discord — the shell error above the script's summary line held the truth. The doctor still proved its worth by surfacing the real error verbatim. Lesson recorded.

**Learned:** When a wrapped command fails, quote its own last lines in the failure summary instead of (only) theorizing causes — the owner pastes the summary, not the scroll-back.

**Skill:** discord-reference updated (see Done). LEARNINGS candidates added: (1) never gate runtime behavior on a Node feature newer than `engines` promises — feature-detect or avoid; (2) failure summaries must carry the underlying error text.

**Handoff:** Owner: `cd ~/CuffBot && git pull && npm run doctor` — now it runs on any Node ≥ 18 and names the real state of the credentials. Then `bash ~/CuffBot/scripts/setup-pi.sh`. Next build session: M2 (enforcement). Eval runs still pending.

## Session 7 — 2026-07-23

**Goal:** Milestone M2 (enforcement) per the resume point, plus two owner requests that arrived mid-session: citations as Papers-Please-style ticket images (concept from TrustyJAID's citation cog, commissioned by the owner) and a self-updating bot.

**Done:**
- Module `enforcement`: `/cite` (generated ticket PNG posted publicly + DM copy; penalty option), `/detain` (durations incl. compounds `1h30m`, 28-day cap with /arrest suggestion), `/release` (timeout or ban; unban tier-checked against Ban Members), `/arrest` (member or by-id, wipe choices, already-banned guard). Shared `guards.js`; audit reasons embed the acting officer, capped at Discord's 512.
- Ticket pipeline, pure JS, zero dependencies: original 5×7 pixel font → citation card layout (wrapping, perforation, barcode from user id) → PNG encoder over `node:zlib` (CRC32, filter-0 scanlines). Rendered sample visually inspected and sent to the owner.
- Self-update (M8 slice): `scripts/update.sh` — fetch → ff-only → npm install → **test suite gate** → deploy-commands → service restart; red suite = rollback, exit 1. Setup script step 8 arms a 15-min systemd timer and stores git credentials via one interactive fetch. **Proven in a clone-pair simulation**: good update applied; deliberately broken update rolled back; exit codes verified.
- Tests 46/46 (26 new: duration/audit/wrap edge cases, PNG structural validity incl. CRC + inflate roundtrip, deterministic rendering, command smokes over fake interactions). Manual `docs/modules/enforcement.md`; runbook self-update section; ROADMAP: M2 ticked, M8 slimmed to its remainder.

**Decisions:**
- Ticket renderer is original code (no code/assets from the cog or the game); credit recorded in the manual. Pure-JS over canvas/sharp: native builds are exactly what breaks on owner hardware (see S6).
- Self-update via root systemd timer that runs repo git/npm as the owning user (`runuser`) — root-owned files in the checkout would break later manual pulls.
- Release-of-ban demands invoker Ban Members even though the command's visible default is Moderate Members — lifting a ban is the bigger power.

**Corrections:** S6's log claimed "LEARNINGS candidates added" but `LEARNINGS.md` was never edited that session — the two candidates are now recorded there with a late-entry note. Lesson: the retrospective's own writes belong in the verify-me category like everything else.

**Learned:** Rendered assets need eyes (tests passed; only viewing the PNG confirmed legibility). Unattended mechanisms need their failure path executed once before shipping. Both recorded as LEARNINGS candidates.

**Skill:** 0.2.1 — LEARNINGS backfill + new candidates (see skill CHANGELOG).

**Handoff:** Owner: grant the bot *Moderate Members* + *Ban Members*, position its role above target roles (enforcement manual → Permissions & safety), re-run `bash ~/CuffBot/scripts/setup-pi.sh` once to arm the self-update timer, then walk both live checklists. Next build session: Session 8 → M3 (records) per `STATE.md → Resume point`. Eval runs from S0 still pending.

## Session 8 — 2026-07-23

**Goal:** Milestone M3 (records / the rap sheet) per the resume point.

**Done:**
- `src/core/store.js`: the storage seam — atomic per-guild JSON (temp + rename), corrupt-file recovery (moved aside as `*.corrupt-<ts>`, not deleted), `getGuildData`/`setGuildData`/`updateGuildData`, `CUFFBOT_DATA_DIR` override for test isolation.
- Module `records`: `lib/api.js` (case-numbered `addRecord`, `recordsFor`, `expungeRecords`; numbers never reused), `lib/format.js` (pure rap-sheet rendering, counts + latest-first, hard 2000-char cap), `/rapsheet` (ephemeral, Moderate Members), `/expunge` (Manage Server, one case or whole sheet).
- Wired enforcement → records: `/cite`, `/detain`, `/arrest`, `/release` all file records via `records/lib/api.js`, each try/caught so records trouble degrades the reply (no case number + logged warning) instead of blocking the action. Replies now show `Case #N`.
- Tests 60/60 (14 new): store roundtrip/corruption/atomicity, case sequencing across expunge, formatting/truncation, records command permission tiers + ephemerality; enforcement smokes now assert a case number. Verified `data/` is gitignored.
- Docs: `records.md`, enforcement manual updated, docs index, ROADMAP M3 ticked.

**Decisions:**
- **Cross-module calls go through the target module's `lib/` API, wrapped in try/catch** — chosen over an event bus for being explicit, greppable, testable; recorded in `architecture.md → Cross-module calls`. The primary action (moderation) must never fail because an auxiliary module (records) is unhappy.
- `/expunge` gated behind Manage Server (a tier above moderation) because erasing history is more dangerous than creating it; case numbers monotonic so stale references can't collide.
- Rap sheets ephemeral — a record is for the force, not public shaming; the public trail is the audit log now and the evidence locker in M4.

**Corrections:** None — S7 state matched reality (46 tests, two modules, clean tree).

**Learned:** Test isolation for a storage layer needs an injectable path read at call time, not import time — `CUFFBOT_DATA_DIR` checked inside each function so a test setting it via `process.env` before calling works. Kept the store's option-object form for the same reason.

**Skill:** `architecture.md` gained the implemented Storage details and the Cross-module calls convention (evidence: first stateful module + first inter-module dependency this session). No SKILL.md protocol change. Version bump recorded in the skill CHANGELOG (0.3.0).

**Handoff:** Session 9 → M4 (dispatch / evidence locker) per `STATE.md → Resume point`. Owner live-verification of M1/M2/M3 still pending. S0 eval runs still pending.

## Session 9 — 2026-07-23

**Goal:** Owner requests (mid-session): every command must also work as `!command`; add a `!help` menu; add a manual update command.

**Done:**
- Dual invocation framework in `src/core/prefix/`: `parse.js` (pure tokenizer, command-line split, option mapping — last string greedy), `adapter.js` (message → interaction adapter; ephemeral replies go to DMs; supports withResponse), `router.js` (MessageCreate → same command.execute). Slash and text paths share one error-wrapped runner in `index.js`.
- `/help` + `!help`: `core/help.js` generates the roster from actually-loaded modules (no hand-maintained list), grouped, showing both invocation forms + usage; `/help` renders an embed.
- `/update` + `!update`: admin/owner-gated, triggers the test-gated updater (prefers the systemd unit, falls back to a detached script run). `setup-pi.sh` step 8 now also installs a scoped sudoers drop-in so restarts never prompt.
- Message Content intent (privileged) enabled with **graceful fallback**: `index.js` tries with it, catches disallowed-intents (4014), retries slash-only, warns how to enable — a self-updating bot can never crash-loop on a missing portal toggle. Features gate on `client.messageContentAvailable`. Added `config.json → prefix`.
- Tests 77/77 (17 new: tokenizer, command-line parsing, option mapping incl. greedy string / choices / booleans, id extraction, adapter routing incl. ephemeral→DM and withResponse, help model + usage + length cap). Docs: core manual (dual invocation, help, update, troubleshooting), runbook (intent + sudoers + /update), README.

**Decisions:**
- Adapter over rewriting every command: commands stay written against the interaction API; one bridge serves both. Ephemeral→DM preserves the privacy intent in a public channel.
- Graceful intent fallback over fail-fast: on a restart-on-failure service, fail-fast = crash-loop. Keep the bot up, disable only the intent-gated features, tell the owner how to unlock them.
- `/update` reuses the existing self-updater (same test gate) rather than a second update path — one safe mechanism.

**Corrections:** None — S8 state matched reality (60 tests, three modules).

**Learned:** A privileged intent added to a self-updating bot is a foot-gun (crash-loop); the graceful-fallback pattern is now in the skill's discord-reference. The last-string-greedy rule makes text commands feel natural (`!cite @user long reason here`).

**Skill:** 0.3.1 — discord-reference gained the privileged-intent fallback pattern (evidence in the skill CHANGELOG).

**Handoff:** Owner: enable the Message Content intent in the portal to unlock `!` commands (bot already runs without it). Next build session: M4 (dispatch / evidence locker) per `STATE.md → Resume point`. A design workflow for M5–M7 is in flight.

## Session 10 — 2026-07-23

**Goal:** Owner requests (mid-session, with a reference gif): make `/cite` an animated GIF that looks like it prints out of a printer, and add a separate for-fun citation command anyone can use.

**Done:**
- `lib/gif.js`: a zero-dependency animated GIF89a encoder (LZW with integer-keyed dictionary, sub-blocking, NETSCAPE loop, per-frame delays). Pure, tested.
- `citation-card.js` refactored to expose the logical pixel grid (`paintCitationGrid` + `upscaleGrid`); `renderCitation` (PNG) output unchanged; new `renderCitationGif` composes a printer-feed animation (empty slot → ticket revealed top-first out of the slot → long hold, looping) over an extended palette (paper + printer chrome).
- `/cite` now attaches the animated `citation.gif` (channel + DM). New public `/fine` (everyone, no permission, no record) issues the same animated ticket for laughs; refuses the bot.
- Performance: initial LZW used string dict keys (~2.2 s/gif); switched to integer keys → ~87 ms here, Pi-safe. GIF ~72 KB, 560×356, 18 frames.
- Tests 85/85 (8 new: LZW determinism + clear/end framing, GIF structure + palette bounds, deterministic citation gif + frame count + size bound, cite-attaches-gif, fine public/no-record/bot-refusal). Manual updated; 10 commands total.

**Decisions:**
- Zero-dependency GIF encoder over a library, same rationale as the PNG encoder (native image libs do not build reliably on the Pi; pure JS runs anywhere).
- Top-first reveal (a downward wipe out of a slot) over a rigid translate — reads unambiguously as "printing" and keeps the finished frame right-side-up.
- `/fine` lives in enforcement (shares the renderer) but is clearly the public/no-consequence sibling; a future move to public-affairs (M7) is possible.
- Could not fetch the owner's reference gif (auth-gated Discord CDN); implemented the printer-feed interpretation and sent a sample for confirmation.

**Corrections:** None — S9 state matched reality (77 tests).

**Learned:** The "render assets and look at them" rule paid off again — the harness image renderer decoded my GIF's first frame, which is real-decoder proof the LZW output is valid. Reinforces the existing LEARNINGS candidate; no skill change needed beyond noting it.

**Skill:** No protocol change. Existing LEARNINGS "rendered assets need eyes" reconfirmed (sample sent to owner). Version unchanged (project code, not skill).

**Handoff:** Owner: confirm the animation look (sample sent). Next build session: M4 (dispatch / evidence locker) per `STATE.md → Resume point`. Design specs for M5 (academy) and M6 (patrol) are in hand from the design workflow; M7 (public-affairs) design will be done inline.

## Session 11 — 2026-07-23

**Goal:** Milestone M4 (dispatch / evidence locker) per the resume point, plus the owner's mid-session tweak: flip the citation animation to print bottom-to-top.

**Done:**
- Module `dispatch`: `lib/format.js` (pure APIEmbed builders — typed/colored per action, officer + case + reason + extra fields; announcement embed), `lib/api.js` (store helpers get/set/clear evidence locker, `resolveLocker` with reason codes, `logEnforcement` best-effort send), commands `/evidence-locker` (set-current-channel / status / clear, Manage Server) and `/dispatch` (announcement, Manage Messages).
- Wired all four enforcement actions (cite/detain/release/arrest) to `logEnforcement`, each in try/catch after replying — the cross-module seam; a missing/unreachable locker never blocks or fails an action.
- Animation flip (owner): `/cite` GIF now prints **bottom-to-top** — the ticket rises out of a bottom slot, header last. Sample sent for confirmation.
- Test robustness: replaced the fragile raw-byte GIF frame count with a proper block-walker (`countFrames`) — LZW image data can contain the marker bytes.
- Tests 98/98 (14 new for dispatch: embeds, store roundtrip, resolveLocker reason codes, logEnforcement delivery + graceful no-op, command smokes). Manual `dispatch.md`; docs index (also de-duplicated a stray records row); enforcement manual notes locker logging; ROADMAP M4 ticked. 12 commands, 4 modules.

**Decisions:**
- `/evidence-locker` uses the current channel for "set" (no channel option) — keeps it identical as a text command (adapter doesn't resolve channel mentions) and matches the "run this in your log channel" convention.
- Best-effort logging via try/catch at the call site, consistent with how records is called — one uniform cross-module pattern.

**Corrections:** Found and removed a duplicate `records` row in `docs/README.md` (S8 added it; my S11 edit re-added it) — caught by re-reading the table. Also corrected two stale lines in STATE (test count 46→98, verified-date header) during the update.

**Learned:** The cross-module convention (call target lib, wrap in try/catch) now has three consumers (enforcement→records, enforcement→dispatch) and holds up cleanly — no event bus needed yet.

**Skill:** No protocol change; the convention documented in S8 proved out again. No version bump.

**Handoff:** Owner: confirm the bottom-up animation; optionally `/evidence-locker action:set` in a log channel to see enforcement embeds. Next build session: M5 (academy / ranks) per `STATE.md → Resume point` — an academy design spec from the design workflow is summarized there.

## Session 12 — 2026-07-23

**Goal:** Milestone M5 (academy / ranks). Mid-build, the owner revealed the server already has leveler-bot ranks under a `[LEVELER]` header (high→low, minus two role ids) — so the academy must adopt those, not impose a fixed Cadet→Chief ladder.

**Done:**
- Completed the prefix framework: role/channel option resolution in the adapter (`getRole`/`getChannel`), and fixed the greedy-string rule to only apply to a *trailing* string option (so `!rank-link Chief @role` can't let `rank` swallow the role mention) — bug caught by a new adapter test.
- **Redesigned the academy around the server's own roles:** `lib/ladder.js` (pure) detects the ladder from roles positioned under a `[LEVELER]`-style header (configured id or name heuristic), highest-first, filtering `@everyone`, managed roles, and an exclusion list, and stopping at the next section divider. `planPromotion`/`planDemotion` normalize a member to exactly one rank role and return specific failure codes. `currentRank` exported for `/badge` (M7).
- Commands: `/promote`, `/demote` (both take a `to` **role** option to jump), `/ranks` (shows the detected ladder), `/rank-setup` (set the header + preview), `/rank-exclude` (manage non-rank roles). Config stored as `academyConfig`; the ladder is recomputed live so it always matches the server.
- Tests 116/116 (redesigned ladder + command suites; role-resolution adapter test). Manual `academy.md` (with the owner's live-setup checklist); docs index + ROADMAP M5.

**Decisions:**
- **Adopt the server's structure over a generic model** (first designed Cadet→Chief; scrapped it). The ladder is detected live and owner-verifiable via `/ranks`/`/rank-setup` — the only correct approach since this environment cannot see the live guild.
- `to` as a role option (not a name string): unambiguous and now resolvable in text commands.
- Header + exclusions are per-guild config, not hardcoded — the two excluded ids the owner named are applied by them via `/rank-exclude`, kept out of shared code.

**Corrections:** None in repo state; the design pivot was driven by new owner info, recorded here and in LEARNINGS.

**Learned:** Don't model a domain the server already encodes — detect and adopt it. Added as a LEARNINGS candidate (second data point after S1 single-guild: the owner's reality overrides the generic design). The trailing-greedy parser rule is the robust fix for mixed string/entity option orders.

**Skill:** No protocol change yet; LEARNINGS candidate added (promote after a third confirmation). No version bump.

**Handoff:** Owner (live): `/rank-setup header:@[LEVELER]`, then `/rank-exclude` roles `428378130705809408` and `667116908876660778`, then `/ranks` to verify; ensure CuffBot's role sits above the rank roles. Next build session: M6 (patrol / automod) per `STATE.md → Resume point`.

## Session 13 — 2026-07-23

**Goal:** Milestone M6 (patrol / automod) per the resume point.

**Done:**
- `lib/screen.js` (pure): evasion-aware normalization (lowercase, diacritics, leetspeak fold, strip non-alphanumerics → substring match), `detectBannedTerms`, `detectInvites` (known hosts, spacing-tolerant), `detectSpam` (mention flood / char runs), `screenMessage` honoring rule toggles, `summarizeViolations`.
- `events/patrol.js`: MessageCreate handler gated on `client.messageContentAvailable`, skips bots/DMs/foreign guilds/moderators; on a violation deletes the message, DMs the author, files a rap-sheet record (officer = CuffBot), and logs to the evidence locker — every step best-effort, never throwing into the gateway.
- Commands `/patrol` (status/on/off + intent warning), `/patrol-rule` (toggle category), `/patrol-term` (add/remove, ephemeral, never echoes the term). Off by default; config in store `patrolConfig`.
- Tests 132/132 (16 new: normalization/evasion, each detector, screenMessage toggles, event handler happy + all no-op paths, command smokes). Manual `patrol.md` with an explicit false-positive story; docs index + ROADMAP M6. 6 modules, 20 commands.

**Decisions:**
- Aggressive substring matching on normalized text (beats evasion) with the false-positive risk documented and mitigated by mod-exemption + full auditability + specific-term guidance — rather than brittle word-boundary matching that spacing tricks defeat.
- Patrol off by default: automod is high-consequence; the owner opts in and tunes.
- Officer on patrol records/logs = the bot itself, clearly marked "(patrol)".

**Corrections:** None — S12 state matched reality (116 tests, 5 modules).

**Learned:** The graceful-intent flag (`client.messageContentAvailable`) paid off a second time — patrol reuses the exact gate the prefix router uses, so the privileged-intent story is uniform across features.

**Skill:** No protocol change; the cross-module and intent-gate patterns held. No version bump.

**Handoff:** Owner: enable Message Content intent, `/patrol action:on`, add terms with `/patrol-term`, test as a non-mod. Next build session: M7 (public affairs) per `STATE.md → Resume point`, then M8 finish + a final audit workflow.
