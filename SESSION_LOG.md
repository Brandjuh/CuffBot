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

## Session 14 — 2026-07-23

**Goal:** Milestone M7 (public affairs) — the last feature module.

**Done:**
- Module `public-affairs`: `/badge` (member card — rank via academy `currentRank`, record count via records `recordsFor`, join date; both cross-module reads wrapped so the badge always renders), `/wanted` (playful poster embed; deterministic crime + donut bounty per target), `/donut` (fun; deterministic variety), `/911` (report a member to the evidence locker via dispatch `sendToEvidenceLocker`; **anonymity option** that omits the reporter from the embed; ephemeral confirm; graceful "no locker configured" path).
- Added `sendToEvidenceLocker(guild, embed)` to dispatch's lib as the generic locker seam; `logEnforcement` now delegates to it.
- `lib/cards.js` pure (embed builders + deterministic hash/pickers). No privileged intents.
- Tests 143/143 (17 new: hashing/pickers, badge fallbacks, wanted range/stability, donut, report anonymity — reporter id never present when anonymous — and command smokes incl. /911 delivery + no-locker). Manual `public-affairs.md`; docs index + ROADMAP M7. **7 modules, 24 commands.**

**Decisions:**
- Fun commands are pure/deterministic (seeded) so they're testable and stable per target; `/911` output is private-by-construction (ephemeral confirm + mod-only locker), which is why it's safe to leave ungated for everyone.
- `/badge` reads academy/records read-only and degrades to Unranked / 0 entries — a community command must never break because a backend module hiccups.

**Corrections:** None — S13 state matched reality (132 tests, 6 modules).

**Learned:** The cross-module lib seam now has five consumers and held up cleanly for read-only reuse too (badge→academy/records, 911→dispatch). The pattern is proven; a candidate for promotion into the skill next session.

**Skill:** No change this session; will consolidate LEARNINGS in the M8 retrospective.

**Handoff:** All feature modules M1–M7 done. Next session: M8 finish (backup note, rotation runbook, FAQ sweep) + a final adversarial **audit workflow** across the codebase, then close out. Owner live checklist for M7 is in `public-affairs.md → Testing`.

## Session 15 — 2026-07-23

**Goal:** Finish the base: owner's real `/wanted` poster request, M8 ops docs, and a final adversarial audit of the whole codebase.

**Done:**
- **Real `/wanted` poster:** pure-JS PNG **decoder** (`png-decode.js`, node:zlib, filters 0–4, color types 0/2/3/4/6, alpha-over-white) + `poster.js` compositing the member's avatar into a WANTED poster image (headline, framed photo, name, crime, reward); `/wanted` fetches the avatar as PNG, decodes, renders; graceful NO-PHOTO fallback. Decoder proven by round-trip against our own encoder; poster visually verified.
- **M8 ops docs:** `backup-and-recovery.md` (backing up gitignored `data/`, restore, corrupt-file recovery, token rotation via the doctor, moving Pi); README feature overview; docs index Operations section. M8 ticked.
- **Final audit** (Workflow: 6 dimensions × review → adversarial verify): 17 confirmed findings. **Fixed:** the HIGH-severity prefix-parser bug — multi-word `!cite`/`!fine` reasons were silently truncated into `penalty` (corrupting permanent records) and `!arrest`/`!911` reasons were rejected — via per-command `textGreedyArg` + tail-binding of trailing options (regression-tested). Mention-injection hardening (`allowedMentions` on reason-echoing replies). Loader now validates events. Prefix permission checks are channel-aware. Doc corrections (release perms, core Files table). Added the audit's missing-coverage tests (config prefix, dispatch failure paths, adapter DM fallback, academy bot-perms, self-target, detain-not-member, update gate).
- Tests 165/165. Skill 0.4.0 (adversarial-audit-before-done practice + two promoted LEARNINGS).

**Decisions:**
- Zero-dependency PNG decoder (matches the encoder/GIF ethos) so the avatar poster runs on the Pi.
- Parser: per-command `textGreedyArg` names the free-text field; options after it bind from the tail, optional non-strings only when the tail token fits their type, optional trailing strings stay slash-only. This is the general fix for `reason`-before-optional shapes without breaking `duration`-before-`reason`.

**Corrections:** The audit caught my own bug and my own excusing comment. The "trailing-string-greedy" rule I introduced in S12 (and documented as a mere limitation) was in fact corrupting rap-sheet data on `main`. Fixed and shipped; the lesson is promoted into the skill.

**Learned:** Author-written tests share the author's blind spots — a green suite is necessary, not sufficient. An independent adversarial audit is now part of the protocol before declaring a milestone/base done.

**Skill:** 0.4.0 — see its CHANGELOG.

**Handoff:** The base is complete and audited. Two owner questions are open and recorded in `STATE.md → Resume point`: (1) academy XP/VC-time system, (2) AI provider/cost. The rest of the backlog (M10–M14) is buildable on request. I'll ask the owner about these two before building M9/the XP system.

## Session 16 — 2026-07-23

**Goal:** Build the XP/leveling system (owner priority from S15): message + voice XP, auto-rank via the academy ladder, and the owner's mid-session requirement that existing members' XP is seeded from the rank they already hold.

**Done:**
- **Module `leveling`** (8th module, commands 25–27): CuffBot's own XP system, replacing the old leveler bot.
  - `lib/xp.js` pure: message XP with cooldown, voice XP per whole minute, position-based thresholds `round(baseXp·N^1.6)` mapped onto the academy ladder (highest-first), `seedXpForRankIndex` (rank → floor XP), voice eligibility (anti-farm), **promote-only** `planRankSync`, `/level` progress math.
  - **Seeding (owner, this session): "Ik wil niet dat iedereen op 0 begint"** — first sight of a member with a rank role seeds their XP at that rank's threshold floor (they keep the rank, earn the next one in full); rankless members start at 0; runs at most once per member; `seededFromRank` stored and shown on `/level`. Lazy (first message / voice minute / `/level`) — no migration step.
  - Events: `MessageCreate` (XP needs only the event — works without Message Content) and a 60 s `ClientReady` voice sweep (no join/leave bookkeeping; restart loses ≤59 s). Anti-farm: no AFK channel, ≥2 humans, self-deafened earns nothing, bots never.
  - Auto-rank: promote-only sync with audit reasons + no-ping announcements (`/xp-config announce:#channel`, else the channel where it happened; voice promotions without a configured channel stay silent). XP never demotes — `/demote` stays human.
  - Commands `/level` (card + progress bar), `/leaderboard`, `/xp-config` (admin; live thresholds view). All three work as `!` text commands (positional).
  - Academy gained the interaction-free `ladderForGuild(guild)` seam; `resolveLadder(interaction)` delegates to it. Intents: base set now `Guilds + GuildMessages + GuildVoiceStates` (all non-privileged), MessageContent still optional on top.
  - Pi-friendly writes: cooldown hits do no store write at all; a voice tick awards all eligible members in ONE write.
- **Owner decisions recorded (ROADMAP M9, STATE):** AI provider = free tier; **AI rate limits are GLOBAL** — 1 msg/7 s AND max 62 msgs/hour, shared by all users combined.
- Tests 210/210 (45 new across lib/service/commands/events incl. seeding paths and anti-farm). Manual `leveling.md`; academy manual, README (8 modules/27 commands), docs index, Pi runbook updated. Skill 0.4.1 (intent facts; two LEARNINGS candidates).

**Decisions:**
- Seed at the rank's threshold FLOOR (minimum XP consistent with the held rank) — keeps the rank, no instant promotion, and the next rank costs its full span.
- Voice XP via periodic sweep of current voice state instead of session bookkeeping — restart-safe and mute/move-proof by construction.
- Promote-only sync so a redeploy or ladder misconfiguration can never mass-demote (demotion stays `/demote`).

**Corrections:** None to prior state — S15's claims held (165 tests, 7 modules verified before building).

**Learned:** Post-compaction file memory is stale (an Edit failed against remembered text — Read before Edit after a handoff); high-frequency events on SD-card deployments need write-avoidance (fast path + batched tick). Both in LEARNINGS as candidates.

**Skill:** 0.4.1 — discord-reference intent facts (event-only features need no MessageContent; GuildVoiceStates non-privileged, cache-only voice presence).

**Handoff:** Adversarial audit of the leveling module was launched this session; its findings and fixes land in this same PR before merge (addendum below if anything was found). Owner live checklist: `docs/modules/leveling.md → Testing` — critically step 2 (a ranked member's `/level` must show seeded XP, not 0). Next session: M9 AI conversation (all decisions now recorded in `STATE.md → Resume point`).

### S16 addendum — adversarial audit of the leveling module (same session, pre-merge)

The independent audit (13 files, math re-derived, discord.js internals verified) returned **10 verified findings: 1 HIGH, 3 MEDIUM, 6 LOW — all fixed in this same PR**, plus a clean bill on threshold math, seeding idempotence, the promote-only invariant, crash paths, intents, and docs-vs-code.

- **HIGH — permanent seed poisoning:** a member first seen while the ladder resolved empty (header deleted/renamed) was seeded 0 forever; worse, the name-heuristic fallback could adopt a decoy role ("Level 100 Club") as the ladder and auto-grant its roles. Fix: **all automation now requires the admin-pinned ladder** (`/rank-setup` → academy `isPinnedLadder`) — heuristic ladders serve humans only; and seeds **self-heal** (`reconcile` raises XP to the held rank's floor on next sight under a pinned ladder). A detection failure can no longer permanently reset anyone.
- **MEDIUM — duplicate promotion race** (message award + voice sweep crossing a threshold simultaneously → double announce/audit): per-member in-flight guard in `syncMemberRank`.
- **MEDIUM — text path ignored integer bounds** (`!leaderboard 0/-3/500` nonsense or 4096-char embed crash; `!xp-config` bypassing 1–100/10–600): `min_value`/`max_value` now enforced framework-wide in `parse.js` (bind + tail-claim) + defense-in-depth clamp in `leaderboard()`.
- **MEDIUM — `/level target:@bot` created permanent XP records for bots:** refused, nothing persisted.
- **LOW×6:** adapter now enforces `addChannelTypes` (a category as announce channel silently killed announcements); `clear-announce` option (the channel could never be reset); `role.editable` moved inside try (uncached self-member could abort a sweep tick); `setXpConfig` stores sparse overrides (was freezing every default into the store); system messages no longer pay XP; `/level` explains blocked/pending promotions and departed-member leaderboard rows documented.
- **Follow-through beyond the audit:** `/promote`/`/demote` now **couple XP** to the new rank (raise-to-floor / cap-at-floor via leveling's `coupleXpToRank` seam) — without this, promote-only sync would instantly re-promote anyone a human demoted.
- Tests 210 → **230** (bounds, channel types, pinned-gates, self-heal, race, coupling, bot-refusal, system messages, sparse config, clamps). Manuals updated (leveling, academy); STATE resume point now flags the owner's one-time `/rank-setup` pin.

**Learned (added to LEARNINGS):** automation needs a stronger trust gate than human-in-the-loop commands — the academy heuristic was safe under `/promote` because a human watched; the moment leveling automated the same ladder it became an attack/failure surface.

---

## Session 17 — 2026-07-23

**Goal:** M9 — AI conversation (module `detective`): talk to the bot via `/ask` and @mentions, on a free-tier provider, under the owner's exact global rate limits.

**Done:**
- Module `detective` (2 commands, 1 event; zero new dependencies — plain `fetch`):
  - `lib/ratelimit.js` (pure): process-global sliding-window limiter — **owner spec implemented exactly: ONE budget for the whole server, 1 AI message / 7 s AND 62 / rolling hour**; `take(now)` returns themed-refusal data (`reason`, `retryAfterMs`); in-RAM by design (restart forgets ≤1 h, errs generous, spares the SD card).
  - `lib/prompt.js` (pure): detective persona (in-character, answers in the asker's language, ~150 words, declines harmful/personal-data asks, points moderation asks to /commands), question cut at 1000 chars, reply clamp at 1900 + `@everyone`/`@here` neutering, per-channel history pruning (8 exchanges / 30 min).
  - `lib/providers.js`: Groq (`llama-3.1-8b-instant`) + Gemini (`gemini-2.0-flash`), injectable `fetch`, 20 s `AbortSignal.timeout`, ≤400 output tokens; `pickProvider(env)` = `CUFFBOT_AI_PROVIDER` pin or first configured key (Groq first).
  - `service.js`: single `askDetective` pipeline shared by both entry points — enabled? → provider? → question? → **rate limit before any tokens** → provider call; never throws, every branch returns a user-ready in-theme message. Per-channel RAM memory so conversations have context; user turns stored as `Name: question` for multi-user attribution.
  - `commands/ask.js` (defer → editReply; greedy `question` for `!ask …`), `commands/ai-config.js` (admin: enabled toggle, provider/model/usage status), `events/mention-reply.js` (@mention → same pipeline; guards: home guild, no bots/system, no @everyone/role-ping triggers, `!`-prefix left to the router; silent without Message Content).
- `.env.example`: documented `GROQ_API_KEY` / `GEMINI_API_KEY` (+ optional provider/model overrides) with the two key-creation URLs.
- Tests 230 → **254**: limiter edges (7 s boundary, 62-cap, rolling aging), prompt limits, both providers' request/response shapes + error paths via fake fetch, pipeline branches (happy incl. cross-call memory, keyless, disabled, empty, cooldown, provider-error), `/ask` defer contract, `/ai-config` status, mention stripping + all event gates. **No test touches the network; ambient AI keys are deleted at suite start.**
- Manual `docs/modules/detective.md` (incl. Owner setup + troubleshooting); README (9 modules, 29 commands) + docs index rows; ROADMAP M9 ✅; STATE updated (resume: M10; owner actions: rank-setup pin + API key).

**Decisions:**
- Module named `detective` (police theme for "ask the bot"). Groq preferred over Gemini when both keys exist (faster, generous free tier) — override via `CUFFBOT_AI_PROVIDER`.
- Conversation memory is RAM-only (privacy + SD wear): a restart forgets chats; documented.
- The 62/h + 7 s limits are code constants (`DEFAULT_LIMITS`), not owner-tunable config — they encode an owner decision; changing them should be a deliberate code change, not a slider.

**Corrections:** none — but note for honesty: model names (`llama-3.1-8b-instant`, `gemini-2.0-flash`) follow the providers' current free tiers as of knowledge cutoff; if a provider retires one, `CUFFBOT_AI_MODEL` overrides without a code change (troubleshooting covers the symptom).

**State for next session:** M9 shipped and self-merged. Next: **M10 birthdays** (or owner's backlog pick). Owner must add an API key before the detective answers (STATE → Owner actions).

**Skill:** retro run; no protocol gaps found this session (the S16 lessons — Read-before-Edit after compaction, seam conventions — were applied, not re-learned). LEARNINGS S16 "automation trust gate" candidate reconfirmed by design here: mention-replies (automated) get stricter triggers (no @everyone/role pings) than the human-invoked /ask. CHANGELOG unchanged (no skill edits warranted; recorded here per protocol).

---

## Session 18 — 2026-07-24

**Goal:** Owner reports (morning): "AI werkt niet, /ai-config ontbreekt, /help geeft een fout." Diagnose what can be diagnosed from here; make the rest measurable on the Pi.

**Diagnosis from the repo (verified):**
- main is coherent: 710b3db, 254 tests green, discovery lists 9 modules / 29 commands; the /help embed for all 9 modules totals 3850 chars (under Discord's 6000 cap) — so /help does NOT break on current code here.
- The symptom trio (missing /ai-config + dead AI + erroring /help) matches Pi-side chain states we cannot see from this container: registrations not applied (update.sh line 58 discarded deploy-commands output and only warned), and/or the bot service down or on stale code (the timer arming has been an open STATE item since S7).
- Boot-only defects were a real blind spot: NO test ever evaluated src/index.js or src/deploy-commands.js top-to-bottom.

**Done:**
- **doctor v2** (`npm run doctor`) now checks the whole update chain, read-only, with an exact fix per ❌: git behind-origin count (self-updater stalled?), Discord's registered guild commands diffed against the code (`diffCommandSets`, lists exactly which /commands are missing/stale), cuffbot service active?, cuffbot-update.timer armed?, plus the existing credential checks. Verified end-to-end here (fake token: clean sections, exit 1).
- **update.sh hardened:** deploy-commands output is now captured and logged loudly on failure (was `>/dev/null` + a soft warn) with the fix commands; after restart the script waits 5 s and verifies `systemctl is-active cuffbot`, logging an ERROR if the bot is down after an update.
- **Boot smoke tests** (`test/boot-smoke.test.js`): spawn both entry points in an empty cwd without credentials; assert fail-fast with the friendly config error and no SyntaxError/ReferenceError/module-not-found — the import graph of the real entry points is now executed on every `npm test`, including the Pi's update gate.
- Help badges for the two new modules (leveling 📈, detective 🕵️ — showed as '•').
- Runbook troubleshooting rewritten around doctor v2 ("start here for almost everything") with the three exact owner symptoms as rows.
- Tests 254 → **257**.

**Not fixable from here:** the Pi's actual state. The morning report asks the owner to run `npm run doctor` on the Pi and paste the output; every branch of their symptoms now has a named check + fix.

**State for next session:** continuing autonomously with M10 (owner mandate: "ga autonoom verder met alles wat je nog moet doen").

---

## Session 19 — 2026-07-24

**Goal:** M10 — birthdays (owner backlog: "Birthday announcement: User birthday input, Timezone"). Part of the autonomous marathon mandated by the owner ("ga autonoom verder met alles wat je nog moet doen, ik ga slapen").

**Done:**
- Module `birthdays` (4 commands, 1 event): `/birthday-set` (day 1–31 + month 1–12 + optional IANA timezone, default Europe/Amsterdam; calendar-validated incl. Feb 29; **no birth year asked or stored** — privacy by design), `/birthday-remove`, `/birthdays [count]` (upcoming, soonest first, TODAY/tomorrow/in-N-days counted in each member's own timezone, never pings), `/birthday-config` (admin: enabled + announcement channel; announcements stay off until a channel is set).
- Announcement design: **10-minute idempotent sweep** (plus a tick at boot) instead of a missable midnight cron — a Pi rebooting overnight announces on the next tick. Once per member per LOCAL year via `lastAnnouncedYear`, stamped **before** the send (a failing channel skips the year instead of retry-spamming every 10 minutes). Feb 29 birthdays celebrate on Mar 1 in non-leap years. The announcement pings exactly one person: the birthday member.
- Pure calendar math in `lib/birthday.js` — `localDateParts` via `Intl.DateTimeFormat` (full-icu ships with Node), validity, due-selection, day counting with year wrap.
- Tests 257 → **271**: month lengths/Feb 29 validity, timezone validation, one fixed instant being July 24 in Amsterdam AND July 23 in New York, leap rules, due-selection (already-announced / wrong day / corrupt records), year-wrap day counts, ordering, store round-trip, sweep idempotence + next-year re-fire, disabled/unconfigured no-ops, stamp-before-send under a failing channel, sparse config.
- Manual `docs/modules/birthdays.md`; README (10 modules, 33 commands), docs index, ROADMAP M10 ✅, STATE, help badge 🎂.

**Decisions:** no birth year stored (privacy; nobody needs a member's age to celebrate); default timezone Europe/Amsterdam (the precinct's home); sweep-stamp-before-send (duplicate announcements are worse than a skipped year on a broken channel).

**State for next session:** M11 trivia is next in the marathon.

---

## Session 20 — 2026-07-24

**Goal:** M11 — police trivia (autonomous marathon).

**Done:**
- Module `trivia` (3 commands, 1 event): `/trivia [set]` starts a one-question round in the channel — public embed with A–D answer **buttons** (no Message Content needed), first correct press wins a point, one guess per member, 20 s timeout edits the question into a reveal (answer + optional fact). One active round per channel; back-to-back rounds avoid repeating the previous question. `/trivia-scores` (persistent, store-backed, medals), `/trivia-sets` (lists installed banks).
- **Data-driven question banks** (owner requirement "option to add more trivias later"): plain JSON files in `src/modules/trivia/data/`, validated at load (`validateSet`), invalid files skipped with a journal warning instead of crashing the module. The `/trivia` set picker choices are generated from the files at deploy time. Ships with `police-codes` and `world-police` (10 verifiable questions each; only facts, no inventions).
- Buttons handled by a module-owned `InteractionCreate` handler filtered on the `trivia:` customId prefix — coexists with future component modules; stale-round and post-restart presses get a polite ephemeral. Active rounds are deliberately RAM-only (restart forfeits the round, never the scores).
- Tests 271 → **283**: set validation incl. every shipped file, no-repeat picking, the answer state machine (wrong → burned guess, first correct → win, locked after win), render models, leaderboard sorting, per-channel rounds, score accumulation, full command+button flows with fakes, stale/foreign button handling.
- Manual `trivia.md` (incl. "adding a question set" recipe); README (11 modules, 36 commands), docs index, ROADMAP M11 ✅, STATE, help badge ❓.

**Decisions:** buttons over typed answers (works without the Message Content intent and prevents answer-editing); single-question rounds (repeat /trivia for more) over multi-question sessions — simpler state, and scores accumulate across rounds anyway; RAM-only rounds (a forfeited round on restart is harmless; persistent scores are what matter).

**State for next session:** M12 fallen tracker is next in the marathon.

---

## Session 21 — 2026-07-24

**Goal:** M12 — fallen tracker (autonomous marathon).

**Done:**
- Module `memorial`: polls the two owner-specified feeds — 🚒 firehero.org/feed/ → role 627943529544417300, 🚓 odmp.org/feed → role 451095508560379934 — every 30 minutes (plus at boot), with an honest User-Agent.
- `lib/rss.js`: zero-dependency, pure RSS extractor (guid/link/title/pubDate) that survives CDATA, entities (named/decimal/hex), attribute-bearing tags; garbage yields [] instead of throwing; items without guid AND link are dropped (nothing to dedupe on).
- **Baseline-first-sweep:** first sight of a feed marks all current items seen WITHOUT posting — a fresh install honors the fallen going forward, never floods years of history. After baseline: new items post oldest-first, capped 5/feed/sweep, embed + role tag with allowedMentions scoped to exactly that role. Failed sends are NOT marked seen → automatic retry next sweep; no entry silently dropped.
- `/memorial-config` (admin): enabled/channel/`preview` (fetches each feed live and shows the latest entry ephemerally — proves reachability from the Pi without posting or marking seen).
- Tests 283 → **292** (all network-free: fixture feeds + fake fetch): parsing edge cases, entity decoding, oldest-first + caps + seen bounding (200), baseline→post→idempotence, disabled/unconfigured/unreachable no-ops, failed-send retry, embed rendering.
- Manual `memorial.md`; README (12 modules, 37 commands), docs index, ROADMAP M12 ✅, STATE, help badge 🕯️.

**Decisions:** module named `memorial` (respectful over "fallen-tracker"); feeds+roles committed as product constants (owner-given, like homeGuildId); 30-min polling (feeds update rarely; politeness toward memorial organizations); baseline-first-sweep over "post everything on install".

**State for next session:** M13 starboard is next.

---

## Session 22 — 2026-07-24

**Goal:** M13 — starboard (autonomous marathon).

**Done:**
- Module `starboard` — the commendation board. `MessageReactionAdd` watcher: at the configured ⭐ threshold (default 3) the message reposts to the board channel as an embed (author name/avatar, content clamped at 1000 chars, first image attachment rendered, jump link, source channel, star count; never pings).
- **Gateway plumbing:** added the non-privileged `GuildMessageReactions` intent to `BASE_INTENTS` and `Message`/`Reaction`/`Channel` partials to the client, so stars on messages from before the current boot still fire (the handler fetches partials on demand). Both changes live in the fallback path too.
- **Exactly-once boarding:** the boarded-map is claimed synchronously BEFORE the send (two near-simultaneous stars cannot double-post); a failed send rolls the claim back so a later star retries. Map bounded at 1000 (oldest evicted). Bot reactors, the board channel itself, and foreign guilds are ignored by pure rules (`lib/board.js → shouldBoard`).
- `/starboard-config` (admin): enabled / channel / threshold (1–25) + boarded-count status.
- Tests 292 → **301**: the shouldBoard decision matrix, content clamp + image pick + empty-text fallback, map bounding/eviction, post-once/dedupe/rollback, embed rendering, and the event with fakes (threshold boards once, 4th star no-op, wrong emoji/low count/bot/foreign/board-channel ignored, partial fetched before judging).
- Manual `starboard.md`; README (13 modules, 38 commands), docs index, ROADMAP M13 ✅, STATE, help badge ⭐.

**Decisions:** board post shows the star count at boarding time and is not edited afterwards (live-updating counts add write traffic and edit-permission failure modes for marginal value); raw reaction count is used (self-stars count — a community that games its own commendation board is celebrating itself, which is fine).

**State for next session:** M15 chat starter is the last buildable backlog item; then the marathon report.

---

## Session 23 — 2026-07-24

**Goal:** M15 — chat starter (final buildable backlog item of the autonomous marathon).

**Done:**
- Module `chat-starter`: when the configured channel is silent for `idle-minutes` (15–1440, default 180), the 5-minute sweep posts an open-ended question ("💬 Radio check, precinct! …", never pings).
- **Never-monologue guard:** after a starter, at least one HUMAN message must land before the next one — the bot's own posts don't count as conversation, other bots reset only the idle clock. **Off by default** (unprompted posting is opt-in).
- Question sources: 40-question bank in `data/questions.json` (validated at load, no-repeat ring of 10 persisted in the store) + optional `use-ai` — one short generated ice-breaker via the detective's provider (own 15 s call outside the /ask budget; too-short/junk output rejected; any trouble falls back to the list).
- `/chat-starter-config` (admin): enabled/channel/idle-minutes/use-ai/preview (sample question ephemerally, posts nothing; warns when use-ai is on without a provider key).
- Tests 301 → **313**: bank validity+validation, shouldPost matrix, ring avoidance without starvation, activity semantics (human re-arm / bot-own no re-arm / other-bot clock-only), the activity event, no-repeat draws, AI path incl. junk rejection via fake fetch, and the sweep end-to-end (idle→post→refuse-monologue→human→post; failure tolerance).
- Manual `chat-starter.md`; README (14 modules, 39 commands), docs index, ROADMAP M15 ✅, STATE, help badge 💬.

**Decisions:** off by default (a bot that starts posting into channels uninvited after an update would be a nasty surprise); the AI call bypasses the /ask rate budget (one question per hours; keeps member budget intact) but reuses the provider layer end-to-end.

**Marathon complete:** every buildable backlog item (M9–M13, M15) is now built, tested, documented, and merged. M14 (goal tracker) deliberately not built — scope must come from the owner.

---

## Session 23 wrap — marathon retrospective (2026-07-24)

Skill 0.4.1 → **0.4.2**: discord-reference gains the reactions-need-partials fact (S22, load-bearing for starboard); LEARNINGS gains two candidates (module-finish boilerplate wants a script; session = work unit, not conversation). Full retro answers recorded in the changelog entry. Marathon totals: 6 PRs (#17–#22) built, tested, merged, branch reset each time; suite 254 → 313; modules 9 → 14. All owner-backlog items buildable without owner input are DONE; M14 (goal tracker) queued as an owner question. Live-Pi diagnosis (the owner's morning report of a dead AI/missing /ai-config/erroring /help) is measurable with doctor v2 — the owner report asks for its output.

---

## Session 24 — 2026-07-24 · CORRECTION: the marathon shipped modules whose data files never left this machine

**Trigger:** the owner ran the update on the Pi; the test gate refused the checkout — trivia and chat-starter tests failed with empty question banks ("expected 30+ questions, got 0").

**Root cause (verified with `git check-ignore -v`):** `.gitignore` line `data/` — written in S8 for the RUNTIME store at the repo root — matches every directory named `data` at any depth, so `src/modules/trivia/data/*.json` and `src/modules/chat-starter/data/questions.json` were silently excluded from every commit (`git add -A` skips ignored files without a word; `git status` showed clean for the same reason). Local suites passed because the files exist on this machine's disk. S23's claims of "complete" were wrong for any fresh clone. **The S7 test-gated updater did exactly its job: the live bot was never broken — it rolled back and kept serving.**

**Fix:**
- `.gitignore`: `data/` → `/data/` (root-anchored, with a comment explaining why the slash is load-bearing). Root runtime store stays ignored (verified).
- The three question-bank files are now actually tracked and committed.
- New `test/packaging.test.js`: walks every module's on-disk `data/` dir and asserts each file is tracked by git (with the offending ignore rule named in the failure), plus a guard that root `data/` STAYS ignored. Skips gracefully outside a git checkout. This makes the whole "works locally, missing in production" class fail loudly on every `npm test` — including inside the Pi's own update gate.
- Tests 313 → **315**.

**Lesson (LEARNINGS candidate):** local tests validate the disk; production receives the commit — when code loads files at runtime, a test must prove those files are in the commit. Blind spots can live in `.gitignore`, where no unit test looks.

---

## Session 25 — 2026-07-24

**Goal:** three owner requests while live-testing: (1) "een command om de bot te updaten via Discord" — /update existed (S9) but was invisible-by-design (all feedback lived in journalctl); (2) starboard must always show the message text, also from restricted channels; (3) starboard emoji must be configurable.

**Done:**
- **/update feedback loop:** the reply now live-edits through the update's states — `✅ Already up to date` (nothing new), `🔄 fetched old → new, tests running` (on-disk HEAD moved), `🚨 tests FAILED, rolled back` (HEAD moved back) — via a 5 s / max 3 min poll of `git rev-parse` (`classifyPollTick`, pure). The success path restarts the bot mid-command, so the order (channel, requester, start commit) is stored (`updateReport` marker) and core's new `update-report` ClientReady event posts **"✅ Update complete: old → new — back on duty 🚔"** in the invoking channel, pinging the requester. Stale markers (>30 min) are dropped silently; one order at a time; take-once semantics so a normal restart never re-reports.
- **Starboard text always visible:** empty gateway content triggers a REST re-fetch (REST returns content regardless of the Message Content intent), and embed-only messages (bot posts, link previews) get text harvested from embed title/description/fields (`textFromEmbeds`, pure). Restricted channels work whenever the bot can view the channel; documented that Discord sends no events at all without access.
- **Starboard emoji configurable:** `/starboard-config emoji:` accepts a unicode emoji (ZWJ sequences included) or a custom server emoji (`<:name:id>` — stored and matched by ID, since names are not unique; `parseEmojiInput`/`displayEmoji` pure). Junk input gets a specific refusal.
- Tests 315 → **326** (update-status marker/take-once/classify + boot-reporter with fakes incl. same-version and deleted-channel paths; starboard REST-refetch, embed-harvest, custom-emoji matrix, parse/display). Manuals core.md + starboard.md updated.

**Decisions:** the /update poller reads the on-disk commit rather than parsing journal output (no sudo needed, no text-format coupling); marker stamped BEFORE triggering so the report survives the restart; custom emoji identity = ID.

---

## Session 26 — 2026-07-24

**Goal:** owner live report: "!commands don't work, only slash commands." Diagnosis: the Message Content intent is off in the Developer Portal → the S9 graceful fallback is active (slash-only). The bot cannot read message text at all in that state, so this was invisible in Discord — only a boot-time journal warning existed.

**Done (make the invisible state visible in three places):**
- `npm run doctor` now decodes the application's privileged-intent flags from `/oauth2/applications/@me` (`messageContentIntentState`: GATEWAY_MESSAGE_CONTENT / _LIMITED) and reports ✅/❌ **with the exact portal path** — the intent's portal state is now measurable from the Pi, not guessed.
- `/radio-check` reports it in Discord where members notice: "✅ Text commands on the air" or "❌ Text commands OFF: Message Content Intent disabled in the Developer Portal (+ fix)". Uses the runtime `client.messageContentAvailable` truth.
- core.md troubleshooting gained the exact symptom row ("!commands don't work, slash commands do").
- Tests 326 → **328** (flag decoder matrix incl. combined flags; /radio-check both states).

**Owner action (portal, not code):** Developer Portal → CuffBot app → Bot → Privileged Gateway Intents → **Message Content Intent** ON → Save → `sudo systemctl restart cuffbot`. Then `/radio-check` should show ✅ and `!help` works; patrol and @mention-AI-replies also come alive.

---

## Session 27 — 2026-07-24

**Goal:** two owner requests: (1) "/update moet laten zien of het gelukt of mislukt is" — S25 built exactly this, but the owner ran the OLD (pre-S25) /update, which updated silently; plus one honesty gap remained. (2) "Gebruik Gemini 2.5 Flash Lite — RPM 10, TPM 250K, RPD 20" (their free-tier dashboard).

**Done:**
- **/update honesty fix:** the timeout path no longer claims "already up to date" unverified — it now async-fetches origin and distinguishes three outcomes: genuinely up to date; **"there IS a newer version (N commits) but the updater never ran"** (with the sudoers/setup fix); "could not verify against GitHub" (network/credentials → doctor). `behindOrigin()` in update-status (execFile-async so a slow fetch never blocks the gateway).
- **Gemini model → `gemini-2.5-flash-lite`** (owner decision, recorded in code + .env.example; `CUFFBOT_AI_MODEL` still overrides).
- **Daily budget:** the limiter now supports a rolling-24h cap taken from the active provider (gemini 20/day per the owner's dashboard; groq uncapped; `CUFFBOT_AI_DAILY_LIMIT` env override, 0 = off). Checked BEFORE tokens are spent, with a specific in-theme refusal; provider-side HTTP 429 gets its own "free-tier quota tapped out" message. `/ai-config` shows today's usage (X / 20).
- **Chat-starter AI now draws from the same shared budget** (cross-module seam to the detective limiter): with only 20 requests/day, an unmetered ice-breaker channel would starve members' /ask budget. A refused slot silently falls back to the question list — members outrank ice-breakers.
- Tests 328 → **333** (daily-cap grant/refuse/free-after-24h, usage shape, provider defaults + env override matrix incl. 0-disables, the 21st-question refusal end-to-end, the 429 message). Manuals detective/chat-starter/core updated.

**Decisions:** the RPD cap lives bot-side as a POLITE refusal before Google's hard 429 (better UX than opaque provider errors); limits are per-provider defaults + env override rather than store config (they describe the provider's tier, not a server preference).

---

## Session 28 — 2026-07-24

**Goal:** two owner requests: (1) a `/restart` command for after `.env` edits; (2) record/enforce Groq's free-tier rate limits like Gemini's.

**Done:**
- **`/restart`** (core, admin/owner-gated): replies, stores the order (shared update-marker, new `kind: 'restart'`), then `sudo -n systemctl restart cuffbot` — the EXACT sudoers-allowed command (arguments are part of the rule; no flags may be added). Once systemd accepts the job it survives the process death. Fallback without sudoers: exit(1) — the unit runs `Restart=on-failure` + `RestartSec=5`, so systemd revives it either way. After boot the `update-report` event posts "🔄 Restart complete — configuration reloaded, back on duty 🚔" in the invoking channel, pinging the requester (the reporter now branches on marker kind).
- **Groq free-tier limits recorded + enforced:** `dailyLimit: 14_400` (documented dev-tier RPD for llama-3.1-8b-instant) instead of uncapped — never binding under the owner's 62/hour (max 1,488/day) but an honest knob that `CUFFBOT_AI_DAILY_LIMIT` can override if the owner's dashboard differs. RPM needs nothing: the 7 s cooldown caps at ~8.6/min, under both Groq's 30 and Gemini's 10.
- Tests 333 → **335** (restart-kind reporter branch; /restart deny-path writes no marker — the allowed path is deliberately untested, same dangerous-in-tests precedent as /update's S10 owner path). Manuals core.md (+ /restart section) and detective.md; README 40 commands.

---

## Session 29 — 2026-07-24

**Goal:** owner request (AI chat): a rate-limited question must be answered AUTOMATICALLY once the limit clears — nobody retypes — with a fun story in the waiting message.

**Done:**
- **The desk pile** (`lib/queue.js`, pure): cooldown- and hourly-refused questions are parked — the refusal reply tells a rotating in-theme story ("The detective is mid-interrogation — two suspects, one donut, tensions high"), the case position, and the ETA. Rules: cap 5 parked cases; ONE per member (a newer question replaces their parked one); only waits ≤ 1 h park. **Daily-budget refusals never park** (an answer half a day later lands in a dead room): "Come back tomorrow, officer."
- **Auto-answer:** a 10 s flusher (`events/queue-flush.js` → `flushQueue`, injectable) takes a limiter slot when one frees, answers the oldest parked case in its ORIGINAL channel — pinging the asker and echoing their question ("Case reopened — you asked: …") — one per tick so the pile drains at the same cooldown pace members face directly. Dead channels consume the item without a retry loop; parked items for a guild that disabled the AI are dropped without spending budget.
- Pipeline refactor: `completeQuestion` (provider+memory, no limiter) extracted so askDetective and the flusher share one path; both entry points now pass `userId` for the ping.
- `/ai-config` shows the pile size. Queue is RAM-only (restart clears it — someone simply re-asks).
- Tests 335 → **339**: queue rules (replace-per-user, cap, shouldQueue matrix, story format), park→too-soon→flush end-to-end (ping + echo + answer + scoped mentions asserted), dead-channel and disabled-guild flushes, daily-no-park; two daily tests now jump the clock 30 h for a clean rolling-24h window (the process-global limiter made low-limit tests neighbor-sensitive).

---

## Session 30 — 2026-07-24

**Goal:** owner request: chat starter must fire in channel 411609312037961729 after ≥12 h of silence, plus a test option that fires after 30 seconds.

**Done:**
- **Owner defaults committed** (like the memorial feeds — owner-given ids are product config): `DEFAULT_STARTER_CONFIG` = enabled, channel `411609312037961729`, `idleMinutes` 720. Works immediately after update, zero setup; `/chat-starter-config` store overrides still win (sparse config).
- **Restart-proof idle clock:** at boot, `seedActivityFromHistory` reads the channel's most recent message (one REST fetch) and seeds the idle window from its real timestamp — a 12 h window no longer resets to boot time on every self-update restart. If the last message is the bot's own starter, the never-monologue guard stays armed-off; unreadable history falls back to boot time.
- **`test` option** on `/chat-starter-config`: arms ONE real starter ~30 s later in the configured channel (idle window + monologue guard bypassed; the shot counts as a real starter afterwards, so the guard arms normally). Refuses cleanly when no channel is set.
- Refactor: `postStarter(guild, config)` extracted to the service — the sweep and the test shot share one posting path.
- Tests 339 → **343**: the committed defaults, history seeding (human-last → armed, bot-last → disarmed, unreadable → fallback), postStarter direct behavior, the test-option arming + no-channel refusal; the old "disabled by default" assertions updated for the new defaults.

---

## Session 31 — 2026-07-24

**Goal:** owner question + decision: birthday announcements had no default channel (silent until configured); they must land in `411609312037961729`.

**Done:** `DEFAULT_BIRTHDAY_CONFIG.channelId = '411609312037961729'` — committed as product config (S30/memorial pattern; store overrides via `/birthday-config channel:` still win). Works immediately after update, zero setup. Tests 343 → **344** (defaults assertion; the unconfigured-sweep label updated). Manual + STATE updated.

---

## Session 32 — 2026-07-24

**Goal:** owner request: default birthday timezone → the most-used US timezone.

**Done:** `DEFAULT_TIMEZONE` → `America/New_York` (Eastern covers ~47% of the US population — the largest share; the community is US-based). Option description and refusal examples now lead with US zones; invalid stored timezones also fall back to Eastern. Members elsewhere simply pass `timezone:`. Tests 344 → **345** (default assertion + the junk-timezone fallback now provably resolves to Eastern). Manual + STATE updated.

---

## Session 33 — 2026-07-24

**Goal:** owner supplied Groq's free-tier limits for llama-3.1-8b-instant (RPM 30, RPD 14.4K, TPM 6K, TPD 500K). RPM/RPD were already covered (7 s cooldown ≈ 8.6/min; dailyLimit 14 400) — **the token windows were not**, and with conversation memory one request can cost 1 000+ estimated tokens, so a full-rate stream could blow the 6K TPM.

**Done:**
- **Token budgets in the shared limiter:** `take()` now accepts the request's estimated token cost plus provider `tpm`/`tpd` windows (rolling minute + rolling day over the same stamp list; refusal reasons `tokens-minute`/`tokens-day` with honest retry times). Estimation: ~4 chars/token + the reserved 400-token output (`estimateTokens`/`estimateRequestTokens`, pure).
- **Provider metadata:** groq `tpm: 6_000, tpd: 500_000` (dashboard comment incl. RPM 30 note); gemini `tpm: 250_000, tpd: null`.
- **Token-aware history trimming:** `buildMessages` drops the OLDEST exchanges past ~1 200 estimated input tokens — long answers no longer inflate every following request; the new question always survives.
- All three call sites meter tokens: askDetective, the desk-pile flusher, and the chat-starter's aiQuestion (~550 est.).
- **Desk-pile semantics:** a saturated MINUTE parks the question (wait ≤ 60 s — perfect for auto-answer); a spent token DAY does not park ("the detective is out of ink — come back tomorrow"), same rule as the request-day cap.
- `/ai-config` shows the estimated token usage (minute + day) when the provider defines windows.
- Tests 345 → **349**: minute-window enforce/age-out with exact retry math, day-window enforce with a fitting smaller request, provider metadata, estimation + oldest-first trimming (question survives), usage-shape updates.

**Decision:** conservative estimates over exact counts (provider-reported usage arrives AFTER spending; an estimate refused up front protects the quota, and the 400-token output reservation biases safe).

---

## Session 34 — 2026-07-24

**Goal:** two owner requests: (1) "Logger — which options are there? I want to log everything" → a full server logbook; (2) a welcome message in lobby 411609312037961729 the moment someone joins. (Request 3 — a channel list like the FRA bot's — is queued: that repository is not visible from this session; question sent to the owner.)

**Done:**
- **Logbook module** (`/logbook`, admin): six toggleable categories — messages (delete/edit/purge; honest "not in my cache" partials), members (join with account age, leave with roles held, nicknames, role add/remove), moderation (ban with reason, unban), voice (join/leave/move; mute/deaf toggles deliberately ignored as noise), server (channel/role create-delete-rename, emoji add/remove), invites (create/delete). **All categories ON by default** (the owner asked to log everything) — but nothing posts until an admin picks a channel (`/logbook channel:`), because logs are sensitive. One delivery path (`postLog`): master switch → category toggle → the log channel never logs itself → no-ping embed; a failing log write never breaks the event that caused it; CuffBot's own messages are skipped (self-noise). Pure models in `lib/logformat.js`; 19 thin event handlers across three files.
- **Welcome module** (`/welcome-config`, admin): greets every human newcomer in the owner's lobby (committed default `411609312037961729`, S30 pattern) — `{user}`/`{server}` template, pings exactly the newcomer, bots get no welcome, `test` option posts one right now with the invoker as the newcomer. Status embed renders a preview and shows the Server Members Intent state.
- **Server Members Intent cascade:** login now walks a 4-attempt table over (Message Content × Server Members) — most capable first, dropping whatever the portal refuses — so a missing portal switch can never crash-loop the bot. `client.memberEventsAvailable` joins `messageContentAvailable`; surfaced in `/radio-check`, `/welcome-config`, and `/logbook`. Base intents grew: GuildModeration, GuildInvites, GuildEmojisAndStickers; partials + GuildMember.
- Tests 349 → **358** (log models per category, postLog gate matrix incl. the no-recursion guard, all-defaults-on, event fakes: delete/edit incl. identical-content silence, join with account age, ban with reason, voice move vs mute-toggle silence, bot-own-message skip; welcome defaults/placeholders/join ping scope/bot skip/disabled/unsendable channel). Manuals `logbook.md` + `welcome.md`; README 16 modules / 42 commands; skill 0.4.3 (multi-intent cascade generalization in discord-reference.md).

**Owner action required:** enable the **Server Members Intent** (Developer Portal → Bot → Privileged Gateway Intents) + `/restart`, else joins stay invisible to both modules; then `/logbook channel:#…` to start the log.

**Decision:** logbook defaults to everything-on but channel-unset — "log everything" was the request, yet where those logs land must be a deliberate admin choice.

---

## Session 35 — 2026-07-24

**Goal:** owner follow-up on S34, minutes after PR #34 merged: (1) commit their four live log channels as defaults — Member logs `494216579136094217`, Message log `494216579794337802`, Server logs `494216580545380372`, Mod logs `494216581216337931`; (2) newcomers must NOT be pinged by the welcome.

**Done:**
- **Per-category log channels with committed owner defaults** (the now-promoted owner-default pattern): each category resolves its own channel — messages→Message log, members→Member logs, moderation→Mod logs, server→Server logs; **voice→Member logs** (voice is member activity), **invites→Server logs** (server management) — both shared mappings are session decisions the owner can override per category. The logbook now works with ZERO setup after update.
- **Channel precedence** (`resolveLogChannelId`): explicit `/logbook <category>-channel:` → explicit `/logbook channel:` (single-channel override, kept for "everything in one place" and for any S34-stored config) → committed default. Six new `<category>-channel` options on `/logbook`; status view shows where every category lands.
- **Recursion guard generalized:** with multiple log channels, events originating in ANY of them are never logged (deleting old log entries in one log channel must not write entries to another).
- **Welcome never pings** (`allowedMentions: { parse: [] }`): the `{user}` mention still renders highlighted, but nobody gets a notification.
- Tests 358 → **360** (committed-defaults mapping incl. the two shared channels; out-of-the-box routing per category; override-precedence matrix; any-log-channel recursion; welcome no-ping assertion). Manuals logbook.md + welcome.md updated.
- Skill **0.5.0**: promoted "owner decisions become committed defaults" to `architecture.md` (fifth confirmation: S21 memorial feeds, S30 chat-starter, S31 birthdays, S34 welcome lobby, S35 log channels) — first entry in LEARNINGS' Promoted section.

**Also this session (queued as work units):** owner supplied the FRA channellist source — repo `brandjuh/fireandrescueacademycogs`, `channellist/` cog — added to this session via add_repo and cloned at /workspace (ephemeral; re-add in future sessions) → **S36**. Owner requested ladder resilience (rename/move/delete/add rank roles without breaking ranks/XP, quiet reassignment, rate-limit aware) → **S37**.

**Decision:** voice and invites share Member/Server logs respectively rather than getting invented fifth/sixth channels — the owner named exactly four; inventing more channels would contradict them, and per-category overrides make any other split one command away.

---

## Session 36 — 2026-07-24

**Goal:** owner request 3 from S34, unblocked mid-S35 when they linked the source: "the same channel list as the FRA bot" — port `FireAndRescueAcademyCogs/channellist` (Red-DiscordBot cog, Python) to a CuffBot module. The cogs repo was added to this session via add_repo and cloned for study.

**Done:**
- **Module `channellist`** — faithful port, behavior preserved deliberately (same header default, same `**[Category]**` markup, same 4000-char chunk limit, same skip/edit/repost decision rules, same 10 s debounce):
  - **Rendering** (`lib/list.js`, pure): channels in Discord-UI order — uncategorized first (headerless), categories by position, text channels above voice per group; each line `#mention - topic` (topic collapsed to one line); visibility judged for a configurable role (default @everyone). Chunk packing never strands a category header at the bottom of an embed.
  - **Sync engine** (`service.js`): per render — identical → skip (zero writes); same message count → edit in place; grew or any stored message gone → delete + repost. Message ids persisted (restarts keep editing the same posts). Per-guild lock serializes manual and automatic refreshes.
  - **Auto-update** (`events/watch.js`): channel create/delete/update (name/position/parent/topic/overwrites), role permission changes, role deletion, and (bulk) deletion of a posted list message → debounced 10 s into one refresh; ClientReady catch-up for offline changes; auto-update arms only once a list is posted.
  - **Commands:** `/channel-list` (action post/update/remove + channel) with honest result messages; `/channel-list-config` (channel, role, everyone-reset, header greedy w/ `default` restore, emoji w/ `none`, hex color w/ `default`, include-voice, auto-update, ignore/unignore channel-or-category, unignore-id for deleted channels) + settings embed.
  - **No default list channel invented** — the owner named none (deliberate non-application of the S35-promoted pattern; the pattern promotes owner-NAMED values only).
- Tests 360 → **373**: formatting, UI-order grouping (hidden/ignored/orphan channels, ignored category hides children), includeVoice, chunk packing + never-strand rule, decision matrix, color/emoji normalizers, descriptor/render integration, refresh end-to-end (post → skip → edit → repost-after-deletion → force repost), removeList, debounce burst → one edit, defaults. Manual `channellist.md`; README 17 modules / 44 commands; help badge 🗂️.

**Decision:** port faithfully rather than redesign — the owner asked for "the same list as the FRA bot"; where CuffBot conventions differ (flat commands with options instead of Red's subcommand groups, sparse store config), the surface changed but every behavior rule carried over.

---

## Session 37 — 2026-07-24

**Goal:** owner request: "make sure we can rename, move, delete, and add ranks without problems — account for ranks and XP; if necessary give people a different role. Don't announce it massively and respect rate limits."

**Done:**
- **Snapshot-based change detection:** `ladderSnapshot` (ordered rank-id list) in the guild store. Compared on role position/create/delete events (debounced 15 s — a UI drag-reorder fires one event per shifted role), after `/rank-setup`/`/rank-exclude` (cross-module seam academy→leveling; config changes fire no role events), and at boot (catches changes made while the bot was offline). Renames never count — role IDS anchor the whole system.
- **Quiet reconciliation sweep** (`reconcileLadderChange`): per member (skip bots/bystanders) — heal XP UP to the held rank's new floor (existing S16 self-heal, never lowers), then promote-only role sync to what the XP earns under the NEW thresholds. The sweep re-applies exactly the rules the live system already enforces, so the sweep and a member's next message can never disagree (no flapping). Semantics per edit: **rename** free; **reorder** roles stay + XP heals; **delete** ex-holders quietly get the rank their XP now earns; **add** heal only (promote-only keeps held ranks). Human demotions survive: `/demote` capped XP at the demoted floor, so the reconciliation target IS the demoted rank.
- **Baseline seeding:** the first pinned snapshot seeds an XP record for EVERY current rank holder — after a role deletion the held-role trace is gone, so only a pre-existing record can restore ex-holders. Boot triggers this baseline right after this update deploys.
- **Owner constraints honored:** zero announcements (only audit-log reasons: "ladder-change reconciliation"); role writes spaced 400 ms apart; 300-write cap as a runaway brake (rest heals on activity). Full-guild fetch only when the Server Members intent is on; cache fallback otherwise.
- `syncMemberRank` gained an optional `reasonLabel` (events unchanged).
- Tests 373 → **381** (`test/ladder-reconcile.test.js`: baseline+seeding, rename no-op, delete → quiet reassignment with audit reason, reorder → XP heal without role writes, add → heal only, human-demotion survival, unpinned/disabled refusals, debounce burst → one sweep). Manuals leveling.md (+ ladder-change section, checklist item 10) and academy.md (§7 + changelog).

**Decision:** reconcile TO the XP mapping rather than "nearest remaining rank by position" — any other target would be undone by the very next message's promote-only sync (flapping). Threshold shifts on structural edits are inherent to position-based thresholds (an S16 decision); the sweep just applies them all at once, quietly.

---

## Session 38 — 2026-07-24

**Goal:** owner request: a donut economy — everyone starts with 10k, activity pays, win/lose via games. First game: the crook hunt (active channel → random crook icon for 5–20 s; "STOP POLICE" in time catches it for donuts; otherwise the crook steals donuts from a random member, announced). Mid-build addition: birthday members get 50k donuts, mentioned in the birthday announcement.

**Done:**
- **Module `economy`:** balances in `economyUsers` with an **implicit 10,000 🍩 start** — reads never write; the record materializes on the first write (earn/steal/gift), so checking a balance can't bloat the store. Activity pay 5 🍩/message behind a 60 s cooldown (read-only fast path, message-XP pattern). Balances floor at 0 with honest `applied` (the crook can only steal what exists).
- **The crook hunt:** pure rules in `lib/bank.js` (activity window ≥4 msgs/≥2 humans/3 min; 3% spawn roll per message, 10-min per-channel cooldown; 5–20 s linger; 100–300 catch bounty; 50–250 steal; STOP-POLICE matcher that forgives case/punctuation but requires the shout to LEAD the message; injectable random everywhere). One watcher event orders earn → catch → spawn so a shout never doubles as spawn-activity. Expiry picks a victim from the member cache (accounts fallback), names them without pinging. **Spawning is gated on the Message Content intent** — without it the shout is inaudible and the game unwinnable; tracking still runs so enabling the intent starts the game instantly (`/economy-config` explains). RAM hunt state; restart forfeits an open hunt.
- **Birthday gift:** `grantBirthdayBonus` (50,000 🍩; null when economy disabled) called by the birthday sweep via seam, the announcement gaining "The precinct chipped in **50,000 donuts** 🍩" only when actually granted.
- **Commands:** `/donuts [member]` (bots run on electricity), `/donut-board [top 1–25]`, `/economy-config` (enabled/hunt/earn/test-hunt — spawns one crook NOW in a chosen channel).
- Tests 381 → **397** (pure rules incl. the leading-phrase matcher and inclusive random ranges; balance semantics; spawn→catch→closed; expiry steal with named-never-pinged victim; empty-server escape; watcher intent gate; birthday sweep announcing the 50k line). One bug caught by the suite pre-ship: the intent gate sat BEFORE activity tracking, so pre-intent chatter didn't count — reordered (track always, spawn gated). Manuals `economy.md` + birthdays.md; README 18 modules / 47 commands; badge 💰.

**Decision:** hunts refuse to spawn without the Message Content intent rather than spawning uncatchable crooks — a game nobody can win is a bug, not a feature. Victim pool prefers the live member cache (any member can be robbed — matching "een random persoon in de server"), falling back to existing accounts.

---

## Session 39 — 2026-07-24

**Goal:** owner report: `/help` errors — "I think it's too long; split it and show it only to the requester."

**Diagnosis:** correct instinct. One embed carries at most **6000 characters IN TOTAL** (title + description + all field names/values combined) — the per-field 1024 clamp `/help` already had is not enough. At 18 modules / 47 commands the summed fields blew the total cap and Discord rejected the reply (Invalid Form Body).

**Done:**
- **Pure pagination in `core/help.js`:** `renderGroupChunks` (splits an oversized module group at entry boundaries into ≤1024-char field values; continuation fields titled "(continued)") + `paginateHelp` (packs groups into pages with a 5000-char budget under the 6000 cap and ≤25 fields; page 1 carries the intro; multi-page titles numbered "(1/N)"; a small roster stays one unnumbered page).
- **`/help` is now ephemeral** (owner request): page 1 via `reply({flags: 64})`, remaining pages as ephemeral `followUp`s — only the asker sees them. The `!help` text path delivers the same pages by DM (the adapter's established ephemeral→DM semantic; channel messages cannot be ephemeral).
- Tests 397 → **400**: chunk splitting at entry boundaries with zero entry loss, the 18-module regression shape (every page ≤6000 total and ≤25 fields, groups all survive, numbering + intro-on-page-1), single-page rosters stay unnumbered. Manual core.md updated.

**Skill:** discord-reference.md gains the embed-limit pitfall (6000 total ≠ 1024/field; 25 fields; 10 embeds/message) — 0.5.4.

---

## Session 40 — 2026-07-24

**Goal:** owner request: a `/steal` command — attempt to rob another member's donuts; 30% success; success pays you 500 donuts; failure sends the donuts to Brandjuh.

**Done:**
- **`attemptHeist` (economy service):** 30% roll (`heistSucceeds`, strictly-below comparison keeps the odds exact; injectable random). Success: 500 🍩 move **victim → thief**, capped by what the victim actually carries (balances floor at 0; capped amounts reported honestly — "that was everything they had on them"). Busted: 500 🍩 move **thief → the precinct chief = `guild.ownerId`** — resolving "naar mij Brandjuh" to the SERVER OWNER structurally instead of hardcoding a personal user id; a failed attempt never touches the target.
- **Lay-low cooldown:** one attempt per 5 minutes per thief (`lastHeistAt` persisted in the account record, stamped on success AND failure; ephemeral refusal shows the remaining wait). Guards: self-theft, bots, disabled economy — refusals write nothing.
- **`/steal target:`** (everyone): public in-theme outcome messages (HEIST! / BUSTED!), names but never pings; ephemeral refusals. House math documented: EV = −200 🍩 per attempt — a gamble, not an income.
- Config knobs in `DEFAULT_ECONOMY_CONFIG`: `heistChance` 0.3, `heistAmount` 500, `heistCooldownMs` 5 min.
- Tests 400 → **405** (success transfer, failure→owner with untouched target, honest broke-victim cap, cooldown incl. both-outcome stamping and exact wait math, self/disabled guards writing nothing). Manual economy.md; README 48 commands.

**Decision:** "the donuts go to me, Brandjuh" is implemented as **the server owner** (`guild.ownerId`) — no hardcoded personal id; it survives account changes and is correct in any test guild. Success STEALS (victim pays) rather than mints: the command is called steal, and minting would inflate the economy.

---

## Session 41 — 2026-07-24

**Goal:** owner request (revising S40 minutes after it shipped): a **donut pot** — every failed/lost donut pools up in one pot (busted /steal no longer pays the owner; lost game donuts too), +500/day, and once a day each member may try to empty it at 0.5% odds — winner takes all. (The owner also mentioned an earlier message that never reached this session — asked them to resend.)

**Done:**
- **The pot (`economyPot` store record):** balance + lastTopUpDay + per-member attempt days, all persisted (restarts change nothing). **Lazy daily top-up:** +500 per elapsed UTC day, missed days catch up — no timer needed; first sight seeds with today's 500.
- **Every loss flows in:** busted `/steal` (revised from S40's to-owner rule; the S40 "structural person reference" code became one `addToPot` call — the candidate lesson held up), the escaping crook's pickpocketed loot (previously deducted-and-vanished; the escape message now names the pot), and future games via `addToPot(guildId, amount)`.
- **`/pot`:** without options an ephemeral status (balance + rules); `try:True` = the daily attempt — **0.5%** strictly-below roll; win pays the ENTIRE pot to the member and resets it to 0 (next day's 500 reseeds); lose keeps everything; the attempt is spent on both outcomes; per-member per-UTC-day.
- Tests 405 → **409** (lazy top-up incl. multi-day catch-up and same-day idempotence; addToPot; the win/lose/already/per-member matrix with exact threshold checks — 0.005 loses, 0.0049 wins; pot reset + reseed after a jackpot; disabled refusal; the revised heist-failure test proving the owner no longer collects; hunt-expiry test proving the crook's loot lands in the pot). Manual economy.md; README 49 commands.

**Improve:** no new skill lesson — S41 was pattern application; notably the S40 LEARNINGS candidate (structural person references) proved its worth immediately: replacing "pay the owner" with "feed the pot" was a one-function edit because the money-flow endpoint sat behind one call.

---

## Session 42 — 2026-07-24

**Goal:** owner request: "generate a list showing at which XP you earn which rank."

**Done:** `/xp-ladder` (leveling, everyone): lists every rank lowest-first with its exact XP floor — the same `thresholdsFor` numbers the promote-only sync acts on, so the list can never disagree with actual promotions. Includes a "⬅️ you (N XP)" marker on the tier the invoker's XP has EARNED (a hand-given higher rank simply sits above the marker), a "0 XP — no rank yet" opening row, role mentions in an embed (render colored, never ping), the XP-earning rules in the footer, and the unpinned-ladder warning when `/rank-setup` hasn't run. Pure `ladderTable(ladder, config)` in `lib/xp.js`. Tests 409 → **411** (lowest-first order, floors ≡ thresholds, strict increase, empty ladder). Manual leveling.md; README 50 commands.

**Improve:** no skill change — pure pattern application (pure fn + thin command); nothing slowed the session.

---

## Session 43 — 2026-07-24

**Goal:** owner request: the help menu must (1) only show commands the viewer can actually use, (2) be clearer, (3) group by purpose categories (Moderation / gaming / fun / etc) instead of modules.

**Done:**
- **Purpose categories** (`HELP_CATEGORIES` + `COMMAND_CATEGORIES` in `core/help.js`): 🛡️ Moderation, 🎮 Games & Economy, 🎉 Fun, 📈 Ranks & XP, 🎂 Community, 📻 Info, ⚙️ Setup & Admin — all 50 commands hand-mapped. A **loader-walking test** fails the build when a future command is left uncategorized (an uncategorized command would land visibly in a "📦 Other" bucket, and the test forbids that bucket from ever existing in reality).
- **Viewer filtering:** the command flattens every registered command with its `default_member_permissions`; entries the member lacks permissions for are hidden, plus `/update` and `/restart` (runtime-gated admin, `RUNTIME_ADMIN_COMMANDS`) require Manage Server to appear. An unparsable bitfield never hides the menu (fail-open per command).
- **Clearer:** one line per command (`**/name** — description`) instead of the old two-line invocation/usage block — roughly halves the size; the intro explains the `/`-picker and the `!name` text form once. Kept from S39: ephemeral pages under the 6000-char embed cap (text path: DM).
- Tests 411 → **415** (category ordering, member-vs-admin filtering incl. runtime-gated pair, Other-bucket behavior, the real-loader completeness sweep; the old roster smoke rewritten to assert both viewer perspectives + ephemerality). Manual core.md.

**Improve:** the completeness test IS the improvement — category drift is now impossible to ship silently (same family as the S24 packaging test: assert the invariant, not the intention).

---

## Session 44 — 2026-07-24

**Goal:** owner request: birthday input as **YYYY/MM/DD**, and "if possible a dropdown with all timezones".

**Done:**
- **`parseBirthdayDate` (pure):** single `date` option replaces day+month — `YYYY/MM/DD` (also `-`/`.` separators), fully validated against the real calendar: with the year known, **Feb 29 only passes in actual leap years**; years bounded 1900–current; DD/MM/YYYY explicitly refused. The year is **stored but never announced** (ephemeral confirmation says "the year stays private"); the sweep still reads only day/month/timeZone.
- **Timezone picker:** a literal dropdown can hold 25 options — the IANA list has ~400+ — so the `timezone` option uses Discord's native **autocomplete**: `suggestTimeZones(query)` serves the common US zones (+ Amsterdam) on an empty query and substring-filters the FULL `Intl.supportedValuesOf('timeZone')` list as you type, prioritized zones first, capped at 25. The framework gained **autocomplete routing** (`interaction.isAutocomplete()` → `command.autocomplete(interaction)`, fail-safe empty response) — available to every future command.
- Submit-time validation unchanged (autocomplete is advisory; typed junk still gets the friendly refusal). Text path `!birthday-set 1990/05/23 Europe/Amsterdam` works positionally (no autocomplete in text, by nature).
- Tests 415 → **418** (format + separators + order refusal; leap-year and year-bound matrix; suggestions: US-first empty query, substring search, priority ranking, cap, no-match). Manual birthdays.md.

**Improve:** skill 0.5.6 — discord-reference gains the "≤25 select options → use option autocomplete" pattern + the router seam.

---

## Session 45 — 2026-07-24

**Goal:** owner request: make the XP scale bigger/harder — "it must be a real challenge"; voice XP 10 → **1 per minute** (explicit).

**Done:**
- **New defaults (owner decision):** `voiceXpPerMin` 10 → **1**; `baseXp` 100 → **1000**; `exponent` 1.6 → **1.8**. First rank ≈ a few days of real activity; a 10-rank top ≈ round(1000·10^1.8) = **63,096 XP** — a long-haul goal. Message XP stays 15 (the owner named only voice; difficulty lives in the thresholds).
- **Tuning knobs:** `/xp-config` gained `base-xp` (50–100k) and `exponent` (1.0–3.0) so the owner can adjust difficulty live without code changes; the settings embed shows the curve formula. New options sit LAST in the builder so the `!xp-config` positional order is unchanged.
- **Existing members:** nobody loses a rank (promote-only); the S16 self-heal lifts each rank holder's XP to their held rank's NEW floor lazily (next message/voice minute/`/level`) — exactly the mechanism that already handles threshold shifts. Sparse config means the new defaults reach the live guild unless the owner ever overrode those keys (`/xp-config` shows the live values).
- Tests stay **418/418** — default-dependent expectations updated (ladder-reconcile floors 303/580/919 → 3482/7225/12126, promotion smoke 100 → 1000, fakes gained `getNumber`). Manual leveling.md.

**Improve:** none needed — the S37 lesson ("the sweep re-applies the live rules") paid off again: threshold rebalancing required zero new reconciliation code.

---

## Session 46 — 2026-07-24

**Goal:** owner bug report: "the bot says my DMs are closed, but they're open?"

**Diagnosis:** the prefix adapter's ephemeral→DM path swallowed EVERY `author.send` error with `catch(() => null)` and always reported "your DMs are closed" — conflating genuine refusals with payload bugs and network failures, and logging nothing. Two truths hidden by that message: (1) only Discord error **50007** means a refused DM, and (2) even then the usual cause is the **per-server** privacy toggle (Server → Privacy Settings → "Direct Messages from server members"), which is separate from the global DM setting the owner had checked — "my DMs are open" and "this server blocks bot DMs" can both be true.

**Done:**
- `deliver()` now try/catches with the error in hand: **50007** → fallback note names the per-server Privacy Settings toggle and the block-list; **anything else** → "the DM failed on my end, so it lands here instead" — the member is never sent settings-hunting for our bug. Every failure is logged with its code (`journalctl` finally shows what actually happened; if the owner's case was NOT a 50007, the log will now say so).
- Payload preserved on fallback (embeds still delivered, content prefixed with the author mention as before).
- Tests 418 → **420** (50007 → privacy-settings note + embeds intact; a 50035 Invalid-Form-Body → "failed on my end" and explicitly NO false DM-closed/privacy blame). Manual core.md.

**Handoff note:** if the owner reports it again after this update, `journalctl -u cuffbot | grep "Text-command DM"` now contains the real error code — diagnose from there instead of guessing.

---

## Session 47 — 2026-07-24

**Goal:** owner request: a clear wizard for setting up patrol rules.

**Done:**
- **`/patrol-wizard`** (admin, fully ephemeral) — CuffBot's first multi-step component flow: **(1) Overview** (what patrol does — delete → DM → rap sheet → evidence locker, moderators exempt — plus current status), **(2) Choose rules** (multi-select over banned-terms/invites/spam, preselected from the live config), **(3) Review & save** (summary; **✏️ Edit banned terms** opens a prefilled modal — comma/newline separated, deduped, ≤100×64 chars; then **Save & turn ON** or **Save, keep OFF**).
- **Draft semantics:** seeded from the LIVE config (re-running edits instead of resetting), RAM-only with a 10-min TTL, written to the store only on Save — Cancel and expiry change nothing. Every step `update()`s the same ephemeral message; `showModal` is the button's response; the ModalSubmit updates the origin via `isFromMessage()`.
- **Routing:** one module-owned InteractionCreate pump filtering `patrol-wizard:` customIds (the trivia pattern generalized to buttons + selects + modals). `!patrol-wizard` points at the slash form (text has no component interactions).
- Pure logic in `lib/wizard.js` (parseTermsInput, applyRuleSelection, summarizeDraft, TTL rules); rendering in `wizard-ui.js`; draft state in service.
- Tests 420 → **429**: term parsing (split/trim/dedupe/clamps), selection mapping, summaries, TTL expiry, and the FULL flow end-to-end with fakes (overview → rules → deselect spam → review → modal → enable writes exactly the drafted config and clears state), save-keep-off, cancel-saves-nothing, expired-press honesty, foreign-customId isolation, text-path pointer. Manual patrol.md; README 51 commands; skill 0.5.7 (component-wizard pattern).

---

## Session 48 — 2026-07-24

**Goal:** owner: "check the steal command — I believe I said it should be limited too. Make the cooldown 3 hours."

**Verified:** no steal-limit instruction ever reached a session — S40 shipped with a 5-minute anti-spam cooldown chosen by the session itself (the owner's limit almost certainly sat in the message that was lost in transit around S40/S41, which they flagged at the time). Now specified explicitly: **3 hours**.

**Done:** `heistCooldownMs` 5 min → **3 h** (owner decision, session-tagged comment); the cooldown refusal now formats the wait as hours + minutes ("~2 h 45 min"). Cooldown test rewritten around the 3-hour window (blocked mid-window with exact remaining-wait math; free again at +3 h). Tests **429/429**; manual economy.md.

---

## Session 49 — 2026-07-24

**Goal:** owner request: a `/daily` command — once per 24 hours, grants 25 donuts; a too-early attempt must say when the next claim is possible.

**Done:** `claimDaily` in the economy service — **+25 🍩 per rolling 24 h** per member (`lastDailyAt` in the account record; claim + stamp in ONE store write; rolling window, no midnight rush). Too early → `{code:'cooldown', waitMs}` with the exact remainder, rendered as "fresh in ~14 h 0 min" via `formatWaitMs` — extracted to `lib/bank.js` and now shared with /steal's refusal. `/daily` (everyone, ephemeral, category games). Config knobs `dailyAmount` 25 / `dailyCooldownMs` 24 h. Tests 429 → **431** (claim → +25 on the implicit 10k, mid-window refusal with exact wait math, free at +24 h, disabled refusal; formatWaitMs rendering). Manual economy.md; README 52 commands.

---

## Session 50 — 2026-07-24

**Goal:** owner: "why does /daily arrive by DM? I only want IMPORTANT things in DM, not fluff."

**Diagnosis:** the text-command adapter's ephemeral→DM rule (S9) conflated two intents behind one flag: ephemeral-for-PRIVACY (rap sheets — DM is right) and ephemeral-for-NOISE (game claims, cooldown notices — DM reads as spam). `!daily`'s replies are the latter.

**Done:**
- **`textInChannel` payload marker:** noise-only ephemerals now answer right in the channel on the text path — as a reply to the invoking message WITHOUT pinging (`allowedMentions: { repliedUser: false }`); the marker is adapter-only and stripped before anything reaches Discord. Unmarked ephemerals keep DMing — privacy stays the default, so nothing sensitive changed behavior. Slash-command behavior is untouched (still ephemeral).
- **Marked as noise:** all of `/daily`'s replies, `/steal`'s refusals (bot/self/cooldown/disabled), `/pot`'s view + already/disabled refusals, `/donuts`' bot refusal, `/donut-board`'s empty notice. Admin config views and rap sheets deliberately stay on the DM path.
- Tests 431 → **433** (marked ephemeral → channel with flags+marker stripped and no-ping reply, zero DMs; unmarked ephemeral → still DMs). Manuals core.md + economy.md; skill 0.5.8 (ephemeral-has-two-intents note).

---

## Session 51 — 2026-07-24

**Goal:** owner request: the ASK / talking-AI function may only work in channel `412354971170897921`.

**Done:**
- **The detective's desk:** `DEFAULT_AI_CONFIG.channelId = '412354971170897921'` (committed owner default, S35 pattern). `/ask` outside it → ephemeral redirect naming the desk (a `textInChannel` noise refusal on the `!` path — S50 rule); a bot-**mention** outside it → one short pointer reply ("You'll find my desk in #…") with **zero AI budget spent** (no limiter take, no provider call). Inside the desk everything works as before.
- **`/ai-config`** gained `channel:` (move the desk) and `everywhere:True` (store channelId null — lift the restriction); the status embed shows the current desk. Sparse store semantics: an explicit null overrides the committed default.
- Desk-pile unaffected by construction: questions can only ENTER the pile from the desk, so flushed answers always land there.
- Tests 433 → **436** (redirect without defer/provider-call + textInChannel assertion; mention pointer with no-ping reply; everywhere-null lifts the lock; existing pipeline tests moved onto the desk channel; ai-config fake gained getChannel). Manual detective.md.

---

## Session 52 — 2026-07-24

**Goal:** owner request: when one or more YouTube creators upload, post the video link in a specific channel.

**Done:**
- **Module `youtube`** — upload announcements without an API key: YouTube publishes a public Atom feed per channel (`/feeds/videos.xml?channel_id=UC…`); same zero-dependency approach as the memorial RSS work (S21), adapted for Atom's `<entry>` shape (CDATA/entity handling, garbage → empty).
- **`/youtube`** (admin): `channel:` (announcement channel — none invented, the owner named no id), `add:` (accepts a `UC…` id, a `/channel/` URL, or an `@handle` — handles resolve via one page fetch), `remove:` (by name or id), `enabled`, `preview:` (live latest-video view, posts nothing). Roster cap 25.
- **Add = validate + baseline:** the feed is fetched once, the channel NAME is learned from it, and the whole back catalog is marked seen — adding a creator never floods the channel; only uploads from that moment on announce.
- **Sweep:** every 10 min + one tick ~15 s after boot; new videos post **oldest-first**, cap 3/creator/sweep; announcement = `📺 **Creator** just uploaded: **Title**` + the plain link (Discord renders the playable card; owner explicitly wanted the link in the channel); never pings. Failed fetch → creator skipped one tick; failed send → video stays unseen and retries next sweep. Seen-ring 50 ids/creator.
- Tests 436 → **446** (parser incl. entities/CDATA/garbage, input matrix, oldest-first cap, seen-ring, announcement format, @handle resolution, add semantics incl. dupe/fetch-fail, sweep end-to-end incl. failed-send retry, no-op guards, remove by name/id). Manual `youtube.md`; README 19 modules / 53 commands; badge 📺.

---

## Session 53 — 2026-07-24

**Goal:** owner request: ping role `625326875442675763` on every new YouTube video.

**Done:**
- `DEFAULT_YOUTUBE_CONFIG.pingRoleId = '625326875442675763'` — committed owner default (S35 pattern). `formatAnnouncement` now leads with `<@&id> ` when a ping role is set; the sweep sends with **`allowedMentions: { roles: [pingRoleId] }`** — scoped to exactly that role, so nothing else in the message (creator names, video titles) can ever ping. Cleared ping → back to fully silent `{ parse: [] }`.
- **`/youtube`** gained `ping-role:` (retarget) and `no-ping:True` (store null — lift the default); the status embed shows the current ping target.
- Tests 446 → **447** (committed-default assertion; ping-variant of formatAnnouncement; sweep asserts the leading role mention + scoped allowedMentions; cleared-ping case back to `{ parse: [] }`). Manual youtube.md (announcement/options/troubleshooting + changelog row); stale "never pings" comments corrected.
- Skill 0.5.9: `discord-reference.md` "Mentions & pings" section — mentions are two layers (content renders, allowedMentions delivers); third mention-control session (S35, S50, S53) finally generalized.

---

## Session 54 — 2026-07-24

**Goal:** owner (verbatim): "Stop met het versturen van DM's na gebruik van een ! command. Doe dit niet!" — a `!command` must never answer by DM.

**Done:**
- **The adapter's DM path is gone.** Every ephemeral-flagged payload on the text path now answers **in the channel** as a reply to the invoking message that pings nobody (`allowedMentions: { repliedUser: false }`). This retires, in one move: the S9 ephemeral→DM rule, the S46 DM-failure diagnostics (no DM left to fail), and the S50 `textInChannel` marker (everything behaves that way now) — marker removed from the adapter and all call sites (economy commands, /ask redirect).
- **Consequence, documented:** output that is private via slash (rap sheets, admin config views, `!help` pages) is now visible in-channel when invoked via `!` — the slash form remains the private variant. Deliberate moderation DMs (citation copy to the offender, patrol removal notice) are separate features and untouched; the adapter was the only reply-DM sender in the tree (verified by grep).
- Tests 447 → **444** (five DM-behavior tests removed with the behavior; new: ephemeral → in-channel no-ping reply asserting the reply path, embeds arrive intact, and a hard "author.send is never called" guard). Manuals core.md (routing rule, !help note, changelog row), detective.md + leveling.md (reply lines); skill 0.5.10 (discord-reference S50 note rewritten S50→S54: never pick DM as the private fallback without owner mandate).

**Decision of record:** third DM complaint (S46 false blame → S50 fluff → S54 ban) — the S9 "DM as ephemeral stand-in" default was wrong for this guild from the start; the skill note now warns future sessions off that default.

---

## Session 55 — 2026-07-24

**Goal:** owner report: the bot has admin rights yet cannot post in channel `411629357082345472` — "it has all rights".

**Diagnosis:** almost certainly not permissions. Every post-target channel picker in the tree (12 commands: welcome, logbook ×2, starboard, chat-starter, memorial, birthdays, channellist ×2, xp announce, ai-config, economy-config, youtube) restricted to `ChannelType.GuildText` — an Announcement (news) channel (type 5) was **unselectable in the picker**, which presents to the owner exactly like a rights problem. On top of that, every sender resolved its channel with `guild.channels.cache.get(id)` — a cache miss was a silent no-op with zero diagnostics.

**Done:**
- **All 12 pickers** now accept `GuildText, GuildAnnouncement`; the text-path adapter's type error says "must be a text or announcement channel".
- **`core/channels.js` — `resolveSendableChannel(guild, id)`:** cache → API fetch fallback, returns the channel only if it has a working `.send`. Wired into every posting path (youtube sweep, welcome, logbook, starboard, chat-starter sweep+post, birthdays, memorial, channellist refresh, leveling announce, update-report). Chat-starter's read-only history peek deliberately stays cache-only (no send requirement).
- **Diagnosis surface:** `/youtube` status now live-probes the configured channel and prints "⚠️ I can't post there (deleted, wrong type, or hidden from me)" instead of leaving a silent sweep no-op.
- `scripts/update.sh` already re-runs `deploy-commands` on every self-update, so the widened pickers register on the Pi automatically.
- Tests 444 → **450** (resolver unit tests: cache hit / fetch fallback / non-postable / no-fetch-method; adapter accepts a type-5 channel — using the owner's channel id; sweep posts on a cache miss via the API). Manuals: changelog rows in all touched modules, youtube.md options/troubleshooting, core.md; skill 0.5.11 (pitfalls row: "all rights but can't post" = type restriction, not permissions).

**Handoff note:** if the owner reports the channel STILL refuses after re-picking it in the widened picker, the next suspect is a genuine per-channel overwrite on the bot's integration role — `/youtube` status (the live probe) plus `channel.permissionsFor(guild.members.me)` will show it; extend the probe to name the missing permission in that case.

---

## Session 56 — 2026-07-24

**Goal:** owner request: "Hunting: post a hunting event at random times in `412354971170897921`."

**Done:**
- **Timed hunts**, layered on the S38 game as a thin scheduler around the existing primitives (S37 rule — no second spawn policy): `runTimedHuntTick(guild)` spawns via the same `spawnHunt` (same flee window, bounty, escape-steal, one-open-hunt guard), targeting the **committed owner-default channel `412354971170897921`** (`huntTimerChannelId`), resolved via `resolveSendableChannel` (S55).
- **Random schedule:** `nextHuntTimerDelay` — uniform 60–300 min (`huntTimerMinGapMs`/`huntTimerMaxGapMs`), re-rolled after every tick with a fresh config read (changes apply without restart); floored at 1 min and min>max-typo-proofed so a bad config can never arm a zero-delay spawn loop. `ClientReady` event `hunt-timer.js` runs the self-rescheduling chain (unref'ed).
- **Gates mirror the activity path:** economy/hunt/timer enabled → Message Content available (unwinnable otherwise — S38 rule; one boot log line says why) → no open hunt in the channel → channel postable ('no-channel' logged per skip).
- `/economy-config` gained `hunt-timer:` + `hunt-channel:` (appended LAST, S44 rule; announcement channels allowed, S55); status embed shows the timed-hunt line.
- Tests 450 → **454** (committed defaults; delay bounds + typo guards; tick matrix: spawned-in-channel + busy on double-tick + catch pays identically, no-intent/off/no-channel). Manual economy.md (rules, options, troubleshooting, testing, changelog).

**Retrospective:** pure pattern application — S37 (reuse live primitives), S38 (intent gate), S44 (options last), S55 (resolver), promoted owner-value rule — nothing new to teach the skill from the build itself. One workflow lesson from S55 recorded in LEARNINGS (import insertion by line heuristic broke on multi-line imports; anchor scripted edits on exact text instead) — skill 0.5.12.

---

## Session 57 — 2026-07-24

**Goal:** owner statement of fact: "Alle intents zijn geregeld. Hoef je niet opnieuw te vertellen, dankje" — all privileged intents are enabled in the portal; stop repeating intent reminders.

**Done:** administrative session, no code. STATE.md's pending-actions block now records the resolution as an owner confirmation (Message Content + Server Members live → text commands, patrol, both hunt modes, welcome, and member logs fully armed) **plus the standing instruction to never repeat intent reminders in owner reports** — future sessions read STATE, so the instruction lives there, not in chat. The Server Members pending item (S34) is cleared; remaining pending items renumbered. Portal state itself is unverifiable from a session container (no bot token here) — recorded explicitly as the owner's confirmation, which is the authoritative source for their own portal.

**Retrospective:** no skill change — pure application of the promoted "owner decisions land in the repo immediately" rule; the general fix (the do-not-remind instruction) belongs in STATE.md where every session reads it, and now sits there.

---

## Session 58 — 2026-07-24

**Goal:** owner request: "Birthday: Geef de jarige de gehele dag de 701577807070756946 rol" — celebrants wear that role for their whole birthday.

**Done:**
- **`birthdayCelebrants` (pure, lib):** everyone whose birthday it is RIGHT NOW in their own timezone — deliberately ignoring the announce stamp, because the ROLE must last the whole local day while the ANNOUNCEMENT fires once. Feb 29 → Mar 1 rule inherited from `isBirthdayOn`.
- **`syncBirthdayRole` (service):** runs at the START of every 10-minute sweep tick (role on before the announcement lands). Celebrants get role `701577807070756946` (**committed owner default**, `birthdayRoleId`) with an idempotent add (skipped when already worn — no API spam per tick); once their local day ends the role comes off. **Only bot-granted roles are ever removed** — the `birthdayRoleHolders` store map tracks what we handed out, so a manually assigned role is never stripped. Failed removals are logged and retried every tick; departed members drop off silently; role writes carry audit reasons. Role sync and announcements each have their own catch — one failing never silences the other.
- **`/birthday-config`** gained `birthday-role:` (retarget) + `no-birthday-role:True` (stop handing out a role), appended LAST (S44 rule); status embed shows the current role.
- Tests 454 → **459** (committed default; celebrants-ignore-stamp; full day cycle worn→idempotent→removed→quiet; blocked removal retried + manual role untouched; no-role/departed-member no-ops). Manual birthdays.md (at-a-glance, options, how-it-works, troubleshooting, changelog).

**Retrospective:** no skill change — the build is pattern application (committed owner default 0.5.0, S37 self-heal loop shape, S53-style clear knob). The one design decision worth naming is in the manual: "only remove what you granted" (holder map) — recorded there rather than as a skill rule until a second module needs it.

---

## Session 59 — 2026-07-24

**Goal:** owner request (Selfroles): post a list in `625276074833608705` of all roles members can give themselves, taken from the role list under the `self-roles` header; per-role configurable info; toggle buttons under the message (press = get, press again = lose); the bot keeps the list current and can always adjust it.

**Done — new module `selfroles` (20th module, 54th command):**
- **Section detection (pure `lib/selfroles.js`):** roles under the role named `self-roles` (decorations/case ignored), using the academy's divider rules (`isSectionDivider` shared import — same section semantics everywhere); skips managed roles, `@everyone`, and — security rail — **any role with elevated permissions** (Admin/Manage*/Moderate/Kick/Ban/MentionEveryone), each skip visible in `/selfroles` WITH its reason; cap 25 (Discord's 5×5 button limit), overflow reported.
- **The posted list:** one embed (emoji + **name** — info text per role) + `selfroles:toggle:<roleId>` buttons in channel **`625276074833608705`** (committed owner default). Tracked in `selfrolesMessage`: refresh edits in place, a deleted message reposts and re-tracks (channellist pattern, second use → skill 0.5.13 generalized it into discord-reference). Role create/delete/update debounce 15 s into one refresh; boot catch-up 20 s (only once posted — `/selfroles post:True` is the explicit go-live).
- **Toggle (button pump, patrol-wizard pattern):** press = add, press again = remove; validated against the LIVE section every press (a role moved out or newly elevated is refused and the stale list self-refreshes); audit reasons on writes; hierarchy failures answered honestly; all replies ephemeral and ping-free.
- **`/selfroles`** (admin): enabled/channel/post + per-role `role: info: emoji:` (greedy `info` on the `!` path) and `clear-info`; info changes auto-refresh the list; setup view shows detected + skipped + message state.
- Tests 459 → **471** (header matching, section rules incl. divider stop/skip reasons/cap, rendering, committed default, post→edit→repost cycle, refresh codes, toggle both directions + refusals + blocked-write honesty, info round-trip, button-row limits). Manual `selfroles.md`; docs index; README 20 modules / 54 commands; help badge 🎭 + admin category (completeness test green).

**Deferred:** custom per-role emoji validation is lenient (invalid emoji falls back to label-only); revisit only if the owner hits it.

---

## Session 60 — 2026-07-24

**Goal:** owner request: separate channels for the Fallen Officers and Fallen Firefighters memorial feeds ("voor beide een aparte kanaal kunnen invoeren").

**Done:**
- `channelIdForFeed(config, feedId)`: a feed's own `<feedId>ChannelId` wins over the shared `channelId` fallback — the original single-channel setup keeps working unchanged. No ids invented (the owner named none): `DEFAULT_MEMORIAL_CONFIG` gains `odmpChannelId`/`fireheroChannelId`, both null.
- Sweep now resolves the channel **per feed** (S55 resolver): a feed without a usable channel is skipped — and deliberately NOT baselined, so its history is honored correctly once a channel arrives later — while the other feed keeps posting. The `!config.channelId` early-return is gone (per-feed-only setups are valid).
- `/memorial-config` gained `officers-channel:` + `firefighters-channel:` (appended LAST, S44 rule; text+announcement per S55); the status embed shows each feed's own target ("(shared)" marks the fallback) and the shared channel line reads as the fallback it now is.
- Tests 471 → **474** (defaults + fallback rule; two-channel routing end-to-end incl. baseline-without-shared-channel; one-feed-unconfigured skip incl. the not-baselined assertion). Manual memorial.md.

**Retrospective:** no skill change — direct application of the per-target-override pattern (S35 logbook per-category channels) plus existing rules; the logbook precedent made this a small session.

---

## Session 61 — 2026-07-24

**Goal:** owner: Fallen Officers = channel `451095508560379934`, feed `odmp.org/feed`, ping role `627946543273738240`; and research the best Fallen Firefighters source — firehero.org has no memorial-specific feed (its feeds carry all site news).

**Correction of record (S21):** the id `451095508560379934`, committed in S21 as the odmp feed's ROLE, is actually the owner's officers **channel** — meaning the officers ping has pointed at a non-role since S21 (rendered dead, pinged nobody). Fixed: it now lives in `DEFAULT_MEMORIAL_CONFIG.odmpChannelId`; the real ping role `627946543273738240` sits in `FEEDS`.

**Research finding:** live probing is IMPOSSIBLE from this session — the network gateway answers 403 to CONNECT for all external hosts (verified against firehero.org, odmp.org, apps.usfa.fema.gov; recorded as an environment fact in STATE). Committing an unverified feed URL would break iron rule 2. Therefore:
- **Firehero feed made safe today:** per-feed `match` rules (`itemMatchesFeed`, pure) — the firehero feed passes only hero-profile items (`/fallen-firefighter/` links); plain news can never post. Baseline semantics refined: fetch FAILURE returns null (no baseline, retry), while an empty or all-filtered SUCCESS does baseline — the first matching item ever is posted, not swallowed.
- **`/memorial-config probe:<url>` (S61):** fetches ANY candidate feed live from the Pi (which has open internet) and shows HTTP state, item count, and the newest three titles/links — the owner verifies candidates from Discord; the next session commits the winner. Candidate to try first: USFA's firefighter-fatality notices (official memorial-specific source, `apps.usfa.fema.gov/firefighter-fatalities/` — exact RSS URL to be confirmed via probe).
- Preview now distinguishes unreachable vs no-matching-items and shows "X of Y pass the memorial filter".

**Done:** FEEDS odmp role corrected + comment trail; `odmpChannelId` committed default; firehero `match` filter; `probeFeed` + `probe:` option (appended last); tests 474 → **479** (owner-decision assertions, filter matrix, filtered-sweep end-to-end incl. baseline-on-all-news, null-vs-empty, probe outcomes; legacy tests adapted to the new defaults/filter — each adaptation is the new behavior, not a weakened assertion). Manual memorial.md; skill 0.5.14 (probe-surface candidate in LEARNINGS).

**Handoff:** waiting on the owner for (a) the firefighters channel id, (b) probe results of candidate feeds. When both land: commit `fireheroChannelId`, and either swap the firehero URL for the verified source or keep the filter — one small session.

---

## Session 62 — 2026-07-24

**Goal:** owner's live screenshot of `/memorial-config` (probe + status) surfaced three facts; make the fixable one fixable from Discord.

**Live facts learned (screenshot):**
1. **Probe of `firehero.org/feed/`: 10 items, ALL news** (scholarships, awards) — zero hero profiles. The main firehero feed is confirmed dead for memorial purposes; the S61 filter correctly passes nothing. USFA probe still to be run by the owner.
2. **The committed firehero role `627943529544417300` no longer exists** on the live server (rendered @unknown-role) — and roles were hard-committed in FEEDS with no way to fix them without a code change.
3. **The tracker is disabled on the live server** (`enabled: no` in the store) and the owner re-confirmed the officers ping role `627946543273738240` (matches the S61 commit; renders correctly).

**Done:** per-feed ping-role overrides mirroring the S60 channel pattern — `odmpRoleId`/`fireheroRoleId` (default null → the committed FEEDS role), `roleIdForFeed`, sweep pings the override with scoped `allowedMentions` (and cleanly no-pings when a feed has no role at all); `/memorial-config` gained `officers-role:` + `firefighters-role:` (appended LAST); the status view now checks `guild.roles.cache` and prints "⚠️ role … no longer exists — set a new one with `firefighters-role:`" instead of blindly rendering @unknown-role. Tests 479 → **481**. Manual memorial.md.

**Retrospective:** no skill change — S62 is the S60 override pattern applied to roles; the deeper lesson (committed ids can rot on the live server → every committed id needs a config override + a status probe) is emerging across S55/S61/S62 but is not yet distinct enough from existing candidates to record separately; revisit if it recurs.

**Handoff:** owner must still (a) run `/memorial-config enabled:True`, (b) probe the USFA URL, (c) supply the firefighters channel + role (now self-serve via options).

---

## Session 63 — 2026-07-25

**Goal:** owner: the /steal and /pot texts read as clutter ("rommelig"), and the pot-crack interface (`/pot try:True`) is unpleasant — make it all better.

**Done:**
- **`/pot` is now a view:** one tidy embed — the balance as a big headline, how the pot fills, **whether YOUR daily shot is still open** (new read-only `hasPotTryToday`), and the odds. The `try:` option is gone.
- **`/crack-pot` (55th command):** the daily attempt as its own command. Win = loud green JACKPOT embed (public); loss = one calm gold line (public); already-tried/disabled = short ephemeral notes.
- **`/steal` outcomes are short color-coded embeds:** green **HEIST!** with the haul as a big `# +N 🍩` line (plus an italic "that was everything they carried" when capped), red **BUSTED!** with the confiscation and a one-line pot pointer. Refusals stay one-line ephemerals. All embeds ping nobody.
- Tests 481 → **482** (hasPotTryToday day-flip). Manual economy.md; README 55 commands + economy row; help category `crack-pot: games` (completeness test green).

**Retrospective:** no skill change — a wording/layout pass plus the S63 command split; no new generalizable mechanism (the "view and act are separate commands" idea is worth watching — if a third case appears after /pot–/crack-pot, record it).

---

## Session 64 — 2026-07-25

**Goal:** owner: the self-roles list must handle well over 20 roles.

**Done:**
- **Multi-message list:** Discord caps a message at 25 buttons (5×5), so `buildSelfRolesPayloads` chunks the section into one message per 25 roles — each with its own embed section (the first carries the intro; later ones title "(continued)") and its own buttons. Sanity cap raised 25 → **125** (five messages); overflow still lands under "Skipped" with a reason.
- **Tracking generalized:** `selfrolesMessage` now stores `messageIds[]` (the pre-S64 single-`messageId` shape is still recognized — live guilds migrate silently on the next refresh). Refresh edits each chunk's message in place, posts missing ones, deletes surplus ones when the roster shrinks, and best-effort-cleans leftovers when the list moves channels.
- Tests 482 → **484** net (payload chunking; the full multi-message cycle post→edit→shrink-deletes-surplus; legacy-record migration; cap test updated to 125 with the new skip reason). Manual selfroles.md; skill 0.5.15 (multi-message variant added to the posted-messages reference).

**Retrospective:** skill 0.5.15 — the S36/S59 "self-updating posted message" reference now covers outgrowing a single message; third use of the pattern, second generalization.

---

## Session 65 — 2026-07-25

**Goal:** owner batch request ("Grote aanpassingen"): 12 new game modules ported from Red-bot cogs, a hunting rework in the style of vrt-cogs/hunting ("this is what I actually want" — police/crooks theme, STOP POLICE), and a daily rework in the style of YamiCogs/payday with crack-the-pot.

**Done (intake session — no bot code):**
- **All 8 source repos cloned** (public → plain `git clone` through the git proxy; add_repo refuses cross-owner attaches — recorded in STATE with the repo list for re-cloning).
- **All 14 cogs surveyed:** three parallel read-only survey agents covered the 12 games on a fixed questionnaire (flow / commands / config defaults / exact numbers / port size); I read vrt-hunting (554 lines) and YamiCogs-payday (874 lines) directly since they rework existing CuffBot systems. Survey persisted verbatim at **`docs/porting/S65-cog-surveys.md`** — the porting reference.
- **ROADMAP → M16 "The Games Arcade":** M16.1 hunting rework and M16.2 claims rework first (owner priority), then 12 games ordered smallest-first (connect4 → hangman → russian roulette → split-or-steal → guess-the-candy → rollout → memory → wordle → hammertime), with the three LARGE ports (heist, city, mafia) staged across multiple sessions each. Standing acceptance criteria recorded (pure lib + tests, economy through existing seams, pump pattern, manuals).
- Known cog bugs recorded as deliberate port decisions (rollout tie-crash, memory double-count, wordle hardcoded-6, connect4 tie-stat key) — fixes, each to be noted as a recorded deviation in the module manual.
- Tests untouched: 484/484. Skill 0.5.16 (batch-intake pattern in LEARNINGS).

**Handoff:** next session = M16.1 (hunting rework). Faithful numbers already extracted: intervals 900–3600 s, catch timeout 20 s, fumble 2/17, eagle→undercover-officer salute mechanic, reward range knob, per-type scores + top-50 leaderboard, words/reaction catch modes. Keep escape→pot wiring (owner's own S38/S41 design).

---

## Session 66 — 2026-07-25

**Goal:** M16.1 — the hunting rework (owner: vrt-cogs/hunting "is what I actually want, but police-with-crooks themed and STOP POLICE").

**Done — new module `hunting` (21st module; 3 commands → 58 total):**
- **The wanted board:** 7 crooks with their own shout lines + the **undercover officer** (the cog's eagle): salute 🫡 (or the word) = reward; shouting STOP POLICE at them = a fine **into the donut pot** (recorded deviation — the cog just withdraws). Toggleable via `undercover:`.
- **Faithful mechanics:** the 2/17 fumble roll ported byte-exactly (`randrange(0,17) > 1` hits); vrt scheduling ported exactly (first message ARMS the guild clock at now + random 900–3600 s; a message past the clock locks the channel, re-arms, and spawns after ANOTHER random interval); 20 s escape window; words/reaction catch modes (reaction = 🚨/💥 + 🫡, needs no Message Content — the degrade path; words mode disables outright without the intent, S38 rule); optional response-time display; bounty range 100–300 🍩 (inclusive roll — the cog's `randint(min, max+1)` off-by-one deliberately not ported).
- **Kept from the owner's own design:** escapes pickpocket 50–250 🍩 from a random member into the pot; the S56 hunt channel `412354971170897921` is the committed default channel-list entry.
- **Stats:** persistent per-member per-crook-type catches; `/hunt-stats [member]`, `/hunt-board` (top 25 — deviation from the cog's paginated top 50, recorded); `/hunting` admin covers channels/timing/mode/rewards/test-spawn and shows when the next crook can appear.
- **Surgery on economy:** the S38 activity hunt + S56 timed hunt removed (watcher slimmed to activity pay; hunt-timer event deleted; hunt functions/config/defaults out of service+bank; `/economy-config` reduced to `enabled`+`earn` — a breaking option-list change, deliberate; isCatchPhrase/pickVictim/randomInt stay in bank.js as the shared seam). Hunt tests moved out of economy.test.js.
- Tests 484 → **488** (new hunting suite: defaults, board, exact fumble boundaries, scheduler state machine, mode availability, catch/fine/salute/fumble/escape end-to-end incl. pot flows, leaderboard). Manuals hunting.md (new) + economy.md; README 21 modules / 58 commands; help badge 🦹 + categories.

**Retrospective:** no skill change — the port followed the S65 survey + the batch-intake pattern exactly; the survey doc (docs/porting/) proved its worth on the first use (every number was already extracted). Next: M16.2.

---

## Session 67 — 2026-07-25

**Goal:** M16.2 — the claims rework (YamiCogs/payday model, with crack-the-pot kept in view).

**Done:**
- **The engine (pure `evaluateClaim` + `CLAIM_INTERVALS`):** six intervals with the cog's exact hour table (1/24/168/720/2184/8760); cooldown with exact wait; **the streak rule ported exactly** — claiming within [T, 2T) earns the bonus (flat, or percent mode `base × floor(bonus/100)`, the cog's formula); lapsing past 2T pays base only; first-ever claim pays base (matches the cog's ancient-default-timestamp behavior).
- **Service:** `peekClaim`/`claimInterval` (stamp + award in one write; per-interval `claims` map on the account record; **legacy `lastDailyAt` silently counts as the day stamp** — mid-window members stay mid-window), `claimAll` (the cog's `freecredits all`).
- **Commands:** `/claims` (everyone — every enabled interval ready/wait, the crack-pot attempt state, `collect:True` claim-all with totals) and `/claims-config` (admin — six amounts, streak-bonus, streak-percent). `/daily` now runs through the engine unchanged in shape (streak line appears when configured; day amount 0 reads as disabled).
- **Committed defaults keep S49:** day 25 🍩, all other intervals 0, streaks off. `dailyAmount`/`dailyCooldownMs` retired (recorded deviation: the cog's fixed hour-windows replace the free cooldown knob).
- Tests 488 → **493** (defaults; the full evaluateClaim matrix incl. window edges and the percent-floor formula; per-interval stamping + legacy migration; claimAll first-ever/streak/nothing-ready; daily-through-engine). All pre-existing daily tests passed UNCHANGED through the new engine before the new tests were added. Manual economy.md; README 60 commands.

**Retrospective:** no skill change — second straight session running purely on the S65 survey + established rules. 21 modules, 60 commands, 493 tests. Next: M16.3 (connect4).

---

## Session 68 — 2026-07-25

**Goal:** owner mega-directive (verbatim): "Ik wil een nog veel grotere rewrite ik wil namelijk alles zonder slash commands en enkel in normale text commands met een !command" — plus, mid-session: some commands were de-facto slash-only; use ONE structure for everything, modeled on the Red-DiscordBot command structure of the S65 source cogs.

**Done — the engine switch (CuffBot is text-only):**
- `src/index.js`: the central InteractionCreate command router (chat-input + autocomplete) is GONE; the prefix router is the only command path. Component pumps (module-owned InteractionCreate listeners) are untouched — buttons are not slash commands.
- `deploy-commands.js` now **DE-registers** (PUTs an empty guild roster). `scripts/update.sh` already runs it on every self-update, so the live Pi clears its slash commands automatically on the next update.
- Doctor check **inverted**: zero registered application commands = healthy; anything registered = "stale slash command(s)" with the clear-it fix. `diffCommandSets` no longer used there.
- `!help` renders text-only (single invocation form, text-only descriptions); radio-check/boot warnings now say ALL commands are off without Message Content (the intent is load-bearing; owner confirmed enabled, S57).
- **Whitelist string sweep** across src: every backtick-quoted `/command` reply reference (28 files) became `!command`, driven by the live loader's command-name list — no false positives on URLs/regex.
- `!patrol-wizard` (the one truly interaction-shaped command) temporarily points at the classic patrol commands; its text-only return is scoped into M17.3.
- Tests 493/493 (six expectations updated to text-only phrasing — each the new intended behavior).

**Owner directive recorded → M17 in ROADMAP:** the Red-style restructure (`!group subcommand args`, bare group = status) — framework first (M17.1), then worst-offender config commands, then everything + legacy-path retirement; full docs sweep rides along per module. M16 games resume after M17.1 so they land in the final structure.

**Retrospective:** no skill change this session — the S9 adapter architecture made "remove slash" a subtraction instead of a rewrite (the seam paid for itself); the real structural work is scoped honestly as M17 rather than rushed into this diff.

---

## Session 69 — 2026-07-25

**Goal:** M17.1 — the Red-style group command framework (`!group sub <args>`, bare `!group` = status/overview), with `!youtube` converted as the reference. Owner: "Ga autonoom verder je staat op auto modus."

**Done:**
- **`src/core/prefix/group.js` (the framework):** group files export `{ group: { name, description, emoji?, permission?, status(ctx)?, subcommands[] } }`; each sub = `{ name, aliases?, description, permission?, args, run(ctx, values) }`. Typed positional args (string/integer/number/boolean/user/role/channel — mentions or raw ids, cache→API fetch; booleans accept ja/nee alongside on/off; last string arg may be `greedy`; `choices` validate case-insensitively). Bare `!group` renders a status + subcommand-overview embed (group `status(ctx)` supplies the state lines; a crashing status still renders the overview); unknown sub = overview + hint footer. `permission` on the group gates everything incl. the overview; per-sub overrides. Refusals, arg errors (with the exact usage line), and crashes (the standard 📻 malfunction apology) are framework-owned — `run()` is happy-path only. `ctx.reply` = the S54 no-ping in-channel reply with channel.send fallback; its allowlist semantics mean content mentions render but never ping.
- **Wiring:** loader accepts `{ group }` commands (`validateGroup` boot-fails on malformed shape or duplicate sub/alias names); router dispatches groups BEFORE the legacy adapter path (legacy flat commands untouched — migration is per-module); `help.js` grew `summarizeCommand` (flattens `{ data }` and `{ group }` to one `{ name, description, defaultMemberPermissions }` shape — BigInt permission → same decimal string as the builder JSON) so groups appear in `!help` with correct permission filtering.
- **`!youtube` converted as the reference group:** subs `on`/`off`, `channel <#channel>` (text/announcement only, refuses others), `add <creator>` (alias `follow`, greedy, typing indicator during the feed fetch), `remove <creator>` (alias `unfollow`), `preview`, `pingrole <@role>`, `noping`. Bare `!youtube` = the status view (enabled/channel with live S55 probe/ping target/roster) + overview. Service and sweep untouched.
- Tests 493 → **515**: new `test/group.test.js` (usage strings, arg matrix incl. Dutch booleans + entity resolution + greedy + choices, overview embed, dispatch matrix: bare/unknown/alias/perm gates at both levels/usage errors/crash apology/no-ping reply/send fallback) + youtube group wiring tests (roster + ManageGuild gate, on/off, channel type refusal, pingrole/noping, remove-through-sub, status incl. S55 probe); loader + help walkers now understand both command shapes.
- Docs: core.md (new "Group commands" section; S68-stale lines in How-it-works/Commands/Files fixed; changelog), youtube.md (subcommand table, group examples, changelog), ROADMAP (M17.1 ✔, youtube struck from M17.2), STATE.md (framework bullet, youtube bullet, resume point → M17.2, tests 515; fixed the dangling "until S69" wizard claim → M17.3).

**Corrections (Step 2):** none — state matched reality (cf0242b, 493/493 green at session start).

**Retrospective (skill 0.5.16 → 0.5.17):** `references/architecture.md` still described the pre-S68 slash architecture ("registers slash commands", `{ data, execute }` as THE command shape) — an M17.2 session following it verbatim would build the wrong shape. Updated it to the text-only reality with the `{ group }` target pattern (example + conventions + youtube reference pointer) and legacy `{ data, execute }` marked migration-only. The allowed-mentions two-layer rule was already covered in discord-reference.md; the group contract details live in core.md § Group commands. Next: M17.2 (selfroles → memorial-config → hunting → logbook → …, pattern = the youtube file).

---

## Session 70 — 2026-07-25

**Goal:** M17.2 — convert every many-option config command to a Red-style group (pattern = the S69 youtube reference). Owner: "Ga verder" (full-auto).

**Done:**
- **Framework extensions (small, then reused 13×):** group-level `aliases` — the loader registers every alias to the same group object (boot-fail on collisions), so retired command names keep working while `!help` lists only primaries; `postable: true` on channel args — the S55 text/announcement post-target rule now lives in ONE place (`resolveArg`) instead of per-command checks.
- **All 13 config commands converted** (naming decision, recorded: Red-style short names, old `-config` names as aliases; `claims-config` keeps its name because `!claims` is the member command): `!selfroles` (on/off/channel/post/info/emoji/clearinfo — info edits still auto-refresh the list), `!memorial` (on/off/channel/officers-channel/firefighters-channel/officers-role/firefighters-role/preview/probe), `!hunting` (on/off/add/remove/mode/showtime/undercover/rewards/interval/timeout/spawn), `!logbook` (on/off/toggle <category>/route <category>/channel), `!claims-config` (six interval subs/streak/streakmode), `!economy` (on/off/earn), `!xp` (on/off/sync/message/voice/cooldown/announce/noannounce/base/exponent), `!ai` (on/off/channel/everywhere), `!birthday` (on/off/channel/role/norole), `!chat-starter` (on/off/channel/idle/ai/preview/test), `!starboard` (on/off/channel/threshold/emoji), `!welcome` (on/off/channel/message/test), and **`!channel-list` absorbed `!channel-list-config`** (post/update/remove + every setting in one group; `unignore` now takes raw ids, retiring `unignore-id`). Builder min/max bounds became in-run range guards (refusal names the valid range, nothing saved). Renamed files to match command names (memorial.js, economy.js, xp.js, ai.js, birthday.js, chat-starter.js, starboard.js, welcome.js).
- **Sweeps:** src stale-reference sweep (user-facing: the detective off-duty hint, the `!claims` collect hint — `collect:True` never even worked positionally; plus every misleading comment); manuals sweep — all 12 module manuals rewrote their command sections to subcommand tables AND their live checklist/troubleshooting lines (changelog rows stay historical); README brought to text-only reality (it still said "both /command and !command" from before S68) — 21 modules, 59 commands (one fewer: the channel-list merge).
- Tests 515 → **528**: `test/config-groups.test.js` (per-group roster/permission/alias/status assertions + the NEW behaviors: hunting guards + channel-list dedupe, logbook toggle/route precedence, claims range refusal, channel-list unignore-by-raw-id, starboard emoji validation, welcome preview, memorial per-feed keys, selfroles status); framework `postable` test; loader alias-resolution test; the four old command-test sites rewritten (adapter fixture is now synthetic — real config commands no longer pass through the adapter).
- Docs: core.md (framework S70 row + aliases/postable in the group section), ROADMAP (M17.2 ✔), STATE.md, this entry.

**Corrections (Step 2):** none — state matched reality (de52cd0, 515/515 at session start). Discovered along the way: README had missed the S68 text-only sweep entirely (fixed here); `!claims collect:True` was documented but unparseable on the text path (fixed to the positional form until M17.3 converts claims itself).

**Retrospective (no skill-file change; 1 LEARNINGS candidate):** the S69 architecture.md update proved itself immediately — this session followed the documented `{ group }` shape without re-derivation. New candidate recorded in LEARNINGS: conversion waves must sweep BOTH src strings and the manuals' live guidance (checklists/troubleshooting), where stale invocation forms actively mislead the owner — changelog rows are history and stay. Next: M16.3 (connect4, as a group) or M17.3 (the rest + legacy-path retirement).
