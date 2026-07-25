# Skill Changelog — run-skill-generator

Every change to this skill (SKILL.md or anything under its directory) gets an entry here, newest first. Versioning: patch = clarification/fix, minor = new capability/section/promoted lesson, major = protocol change (owner approval required). Each entry cites its evidence — the session and observation that motivated it — so future sessions can judge whether a rule still earns its place.

## 0.5.22 — 2026-07-25 (Session 93)

- `references/architecture.md` (Module pattern): documented the third command shape — flat `{ command }` for single-purpose commands — alongside groups and the shrinking legacy path, and added a conversion rule: **convert a command's TESTS to the real dispatch path, not just its code.**
- Evidence: S93. The pre-existing smokes hand-built an interaction and called `execute(it)`, so the arg parsing and the permission gate were simulated by the test rather than covered by it. Rewriting them onto `dispatchCommand` with a shared fake *message* immediately exposed that every permission refusal said "Manage Server" whatever the gate was — three shipped groups (`!maintenance`, `!russianroulette force`, `!hammertime role`) had been telling members to get a permission that would not have helped. The rule also names the two things the slice tripped over so B–D need not rediscover them: entity args need real 15–21 digit snowflakes (the resolver applies Discord's own id rule), and a conversion routinely surfaces commands with no test at all (`!xp-ladder`, `!hunt-stats`, `!hunt-board`).
- Also recorded, in the same section: prefer a NEW shape over bending an existing one when the existing one would change user-visible behavior. M17.3 was written as "convert the rest to groups"; carrying that out literally would have renamed 34 commands the precinct types daily, `!rank-setup` among them — which is a pending owner action.

## 0.5.21 — 2026-07-25 (Session 92)

- `references/architecture.md` (porting rule): sharpened the data-table clause — extract mechanically, and when the data is inert, ship the dump AS the module's data file instead of transcribing and diffing; resolve named constants during the dump.
- Evidence: S89 (96 crime events dumped straight into `data/crime-events.json`) and S91 (46 scenarios + 14 prison-break scripts, whose numbers were module constants that `literal_eval` refused — a small AST walk resolved them). Three tables, zero transcription, zero drift risk; S85's fixture-diff grade stays documented for data that also wants to be code.

## 0.5.20 — 2026-07-25 (Session 85)

- `references/architecture.md` (Module pattern): promoted the twice-confirmed porting rule — transcribe the source runtime's SEMANTICS (including float/int artifacts) and pin them in tests before wiring, plus the large-port corollary: dump the original's data tables by executing it and commit the dump as a fixture.
- Evidence: S82 (`int(5000/3*2)` = 3333, not 3332) and S85 (`int(1000*(1-0.07))` = 929, not 930 — my naive test expectation failed against faithful code, and Python confirmed 929). S84 supplied the library-replacement half (dateutil/pytz → Intl: weekday resolution, fuzzy token-skipping, wall-clock timedelta). S85's fixture diff caught nothing today but makes the 74/28/24-entry transcription permanently checkable after the scratchpad clone is gone.

## 0.5.19 — 2026-07-25 (Session 81)

- `references/architecture.md` (Module pattern): promoted two twice/thrice-proven LEARNINGS candidates — the io-injected engine for timed multiplayer games (S73 russian roulette, S79 split-or-steal, S81 rollout), and the unref'd-timer test keep-alive rule (the "Promise resolution is still pending" cascade bit S73 and S81 identically).
- Evidence: S81 — the rollout suite hit the exact S73 failure again before the keep-alive was added; the engine pattern carried its third game with no design work.

## 0.5.18 — 2026-07-25 (Session 78)

- `references/architecture.md` (Verification habits): never use top-level `await` in test files — the Pi's older node:test runner executes tests registered after an await interleaved/twice (`processPendingSubtests`), so a test's first assertion sees its own later writes; passes silently on newer Node.
- Evidence: S78 — S69's two top-level `await import(...)` lines in test/youtube.test.js kept the Pi's self-update gate red across S70–S77 (2 tests failed only there); the readable Pi log (S76/S77 plumbing) pinned it in minutes.

## 0.5.17 — 2026-07-25 (Session 69)

- `references/architecture.md`: brought in line with the S68/S69 reality — text-only bot (deploy-commands CLEARS the roster), the Red-style `{ group }` command shape documented as the target pattern (with example, permission/error conventions, and the youtube reference pointer), legacy `{ data, execute }` marked as migration-only; stale "registers slash commands" lines fixed.
- Evidence: S69 — while building M17.1 the reference still described the pre-S68 slash architecture; an M17.2 session following it verbatim would write the wrong command shape.

## 0.5.16 — 2026-07-25 (Session 65)

- `LEARNINGS.md`: new candidate — batch "like X" intakes: clone all public sources via the git proxy, survey with parallel read-only agents on a fixed questionnaire, persist the survey under docs/porting/ (the scratchpad is ephemeral; the survey is the porting reference).
- Evidence: S65 — 14 cogs across 8 repos surveyed in one session; the three agent reports became docs/porting/S65-cog-surveys.md and the M16 roadmap entries.

## 0.5.15 — 2026-07-25 (Session 64)

- `discord-reference.md` → self-updating posted messages: the multi-message variant (25-button cap per message → tracked `messageIds[]`, per-chunk edit/post/delete-surplus, legacy single-id records keep working).
- Evidence: S64 — the selfroles board outgrew one message the moment the owner planned 20+ roles; the extension slotted into the existing S36/S59 pattern without touching callers.

## 0.5.14 — 2026-07-24 (Session 61)

- `LEARNINGS.md`: new candidate — unverifiable external resources get a probe surface in the bot, not a committed guess (session containers have no open internet; the bot host does).
- Evidence: S61 — the gateway 403'd every candidate fallen-firefighters feed; `/memorial-config probe:` moves verification to the Pi and keeps iron rule 2 intact.

## 0.5.13 — 2026-07-24 (Session 59)

- `discord-reference.md`: new section — self-updating posted messages (tracked message id + edit-else-repost, per-guild refresh lock, debounced change events, gated boot catch-up, always render from live state).
- Evidence: S59's selfroles board is the second independent use of the S36 channellist shape; the pattern was re-derived from channellist's source instead of read from a reference — now it is written down.

## 0.5.12 — 2026-07-24 (Session 56)

- `LEARNINGS.md`: new candidate — scripted bulk edits must anchor on exact text, not line heuristics (an S55 batch script spliced imports inside multi-line `import { … }` blocks; `node --check` caught it).
- Evidence: S55 (four broken files from one heuristic) recorded during the S56 retrospective; S56 itself was pure pattern application (S37/S38/S44/S55 rules) with nothing new to generalize.

## 0.5.11 — 2026-07-24 (Session 55)

- `discord-reference.md` → pitfalls row: "bot has all rights but can't post in channel X" is usually not permissions — an `addChannelTypes` restriction made the channel's TYPE unselectable (Announcement/news channels vs GuildText-only pickers), which presents exactly like a rights problem. Post-target pickers take `GuildText, GuildAnnouncement`; resolve targets cache→fetch; surface unpostable configured channels in status views.
- Evidence: S55 — owner: "the bot has admin rights but cannot post in 411629357082345472, it has all rights"; every one of the 12 post-target pickers in the tree was GuildText-only, so no session ever saw the failure — the class was invisible until a live channel of the excluded type existed.

## 0.5.10 — 2026-07-24 (Session 54)

- `discord-reference.md` → the S50 "ephemeral has two intents" note rewritten as "Ephemeral on the text path (S50→S54)": the owner banned reply-DMs outright, so every ephemeral now answers in-channel as a no-ping reply; the general lesson is that unsolicited DMs read as spam — never pick DM as the "private" fallback without an owner mandate (deliberate moderation DMs stay a separate, legitimate category).
- Evidence: S54 — owner: "Stop met het versturen van DM's na gebruik van een ! command. Doe dit niet!" — the third DM complaint (S46 false blame, S50 fluff-in-DM, S54 ban); the escalation shows the S9 DM default was wrong for this guild from the start.

## 0.5.9 — 2026-07-24 (Session 53)

- `discord-reference.md` → new "Mentions & pings" section + pitfalls row: mentions are two layers (content renders, `allowedMentions` delivers); deliberate pings scope the allow-list to exactly the target, no-ping renders use `parse: []` / `repliedUser: false`; any message interpolating external text sets `allowedMentions` explicitly.
- Evidence: S53 (scoped role ping on upload announcements) was the third mention-control decision after S35 (no-ping welcome) and S50 (no-ping replies), yet the reference had zero coverage — each session re-derived the same two-layer model.

## 0.5.8 — 2026-07-24 (Session 50)

- `discord-reference.md` → interaction lifecycle: ephemeral has two intents — privacy vs noise-reduction; the text path must route them differently (DM vs in-channel no-ping reply, `textInChannel` marker).
- Evidence: S50 — the owner's `!daily` claims landed in DM ("I only want important things in DM, not fluff"); one conflated concept, two behaviors.

## 0.5.7 — 2026-07-24 (Session 47)

- `discord-reference.md`: new section — component wizards (ephemeral update-in-place steps, showModal-as-response, prefix-filtered module-owned interaction pump, RAM draft + TTL, save-only-at-the-end).
- Evidence: S47's /patrol-wizard — the first multi-step component flow; the trivia button pattern generalized cleanly to selects + modals.

## 0.5.6 — 2026-07-24 (Session 44)

- `discord-reference.md`: new section — select menus cap at 25 options; large choice sets use option autocomplete (`.setAutocomplete(true)` + `command.autocomplete`, routed centrally, fail-safe `[]`, submitted values re-validated).
- Evidence: S44's timezone picker — "a dropdown with all timezones" is impossible as a literal select; autocomplete over `Intl.supportedValuesOf('timeZone')` delivers it, and the router seam now exists for every future command.

## 0.5.5 — 2026-07-24 (Session 40)

- `LEARNINGS.md`: new candidate — person-references in owner specs resolve to structural handles (`guild.ownerId`, role holders) rather than hardcoded personal user ids; complements the promoted owner-defaults rule (channels/values literal, people structural).
- Evidence: S40's /steal — "the donuts go to me, Brandjuh" implemented via guild.ownerId; no id had to be asked for, and tests run against any fake guild.

## 0.5.4 — 2026-07-24 (Session 39)

- `discord-reference.md` → pitfalls table: the embed TOTAL cap (6000 chars across title/description/fields) — clamping each field to 1024 is not enough; ≤25 fields per embed, ≤10 embeds per message; paginate grown rosters.
- Evidence: S39 — `/help` worked for months of sessions and broke silently at 18 modules; the per-field clamp masked the real limit until the total crossed 6000.

## 0.5.3 — 2026-07-24 (Session 38)

- `discord-reference.md` → Client & intents: the degrade-vs-disable rule — a feature that a missing intent makes UNWINNABLE (not merely poorer) must disable itself with an explanation in its config command, while its harmless parts keep running for an instant start once the intent lands.
- Evidence: S38's crook hunt — spawning crooks nobody can catch (the bot can't read "STOP POLICE" without Message Content) is a bug wearing a feature's clothes; the suite also caught the gate sitting before activity tracking, which would have made the game start sluggishly after enabling the intent.

## 0.5.2 — 2026-07-24 (Session 37)

- `LEARNINGS.md`: new candidate — a reconciliation/repair sweep must be a loop over the live path's own primitives, never a parallel policy (two policies = flapping between the sweep and the next event).
- Evidence: S37's ladder-change sweep; the tempting "nearest remaining rank" rule for deleted-rank holders would have fought the promote-only XP sync on every subsequent message.

## 0.5.1 — 2026-07-24 (Session 36)

- `LEARNINGS.md`: new candidate — for "like X" requests, get X's source into the session (add_repo) and port behavior faithfully instead of reinventing from the description; record the source repo + path in STATE.md because workspace clones are ephemeral.
- Evidence: S36 ported the FRA channellist cog 1:1 (the owner's link resolved what no amount of guessing could have); the port's decision rules dropped straight into pure functions with 13 tests.

## 0.5.0 — 2026-07-24 (Session 35)

- `architecture.md` → Module conventions: promoted **"owner decisions become committed defaults"** — an owner-named id/value from chat is committed as the module's code default (session-tagged comment), sparse store overrides win, features work immediately after self-update.
- `LEARNINGS.md`: first entry in the Promoted section (the pattern had been re-derived from session-log precedent five times without ever being written as a rule — S21 memorial feeds, S30 chat-starter channel, S31 birthday channel, S34 welcome lobby, S35 logbook channels).
- Evidence: S35 — the owner supplied four log-channel ids and "no ping for newcomers"; the implementation was pure pattern-application, confirming the rule is stable enough to promote.

## 0.4.3 — 2026-07-24 (Session 34)

- `discord-reference.md` → Client & intents: generalized the S9 graceful-fallback pattern to MULTIPLE privileged intents — an ordered attempt cascade over the intent combinations (most capable first), one per-feature availability flag per intent, each surfaced inside Discord (status/config commands naming the exact portal switch).
- Evidence: S34's welcome + logbook modules need the privileged Server Members Intent on a bot that already fallback-handles Message Content; the 2×2 cascade in `src/index.js` keeps any portal misconfiguration from crash-looping the self-restarting service, and the owner discovers the fix via `/radio-check`, `/welcome-config`, or `/logbook` instead of journalctl.

## 0.4.2 — 2026-07-24 (Sessions 18–23)

- `discord-reference.md` → Client & intents: reaction events need `GuildMessageReactions` PLUS `Partials.Message/Reaction/Channel` (with fetch-on-partial) to fire for messages older than the current boot — without partials a reaction feature silently ignores most of a server's history.
- `LEARNINGS.md`: two marathon candidates — the module-finish boilerplate (manual/README/ROADMAP/STATE/log/badge) is repetitive WORK that wants a script if more modules come; and "a session is a work unit (one PR), not one conversation" (S17–S23 shipped as separate numbered sessions inside a single owner-mandated marathon).
- Evidence: S22 built the starboard (the partials fact was load-bearing: pre-boot messages are the majority case); S18–S23 shipped six PRs in one conversation with the per-milestone checklist done by hand six times.

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
