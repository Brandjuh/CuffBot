# Skill Changelog — run-skill-generator

Every change to this skill (SKILL.md or anything under its directory) gets an entry here, newest first. Versioning: patch = clarification/fix, minor = new capability/section/promoted lesson, major = protocol change (owner approval required). Each entry cites its evidence — the session and observation that motivated it — so future sessions can judge whether a rule still earns its place.

## 0.5.56 — 2026-07-31 (Session 136)

- `references/architecture.md`: **the bot restarts itself constantly — RAM state with a VISIBLE footprint must reconcile at boot and at exit** (ClientReady sweep + the new loader-collected module `shutdown()` hook, run by `gracefulExit` on update-exit and SIGTERM). Manifest shape gains optional `shutdown`.
- Evidence: owner — "Waarom werkt de transcribe niet, de bot is wel in het kanaal." The audio pipeline was intact; the kill was the update loop itself. Live voice sessions are RAM-only, S127 made restarts routine (three merged PRs that day), the exit cleaned nothing (Discord kept showing the dead process's bot in the voice channel), and auto-join only reacts to a human ENTERING a channel, so nothing ever resumed. The S87 scheduler already solved this class for heist ("the durable half is the stored record"); the general rule was never written down, so the next long-lived session repeated the mistake. Fix is two-sided by necessity: resume-at-boot from Discord's own state AND drain-at-exit so the footprint disappears when resuming is wrong. Also: a lingering voice state resumes even with `autoJoin` off — the bot's presence IS the record of a manual join; gating resume on autoJoin was a mutation the tests killed. 11/11 mutations killed; 14 new tests.

## 0.5.55 — 2026-07-31 (Session 135)

- `references/self-improvement.md`: **a clean sweep is only as broad as its classes — record what an audit does NOT measure next to what it does.**
- Evidence: the owner reported city and heist a fourth time ("deze lijken niet eens op werking van de cogs"). S132's five-class audit (parameters, persistence, leaderboards, bare-word invocation, coverage) had come back clean and still holds — and S135's screen-by-screen audit found 27 real divergences per game, every one in flow/pacing/presentation/texts, dimensions no S132 class covered. Both verdicts are true; the misread was letting "clean on five classes" stand in for "clean". One recording-time sentence naming the unmeasured dimensions would have kept the question visibly open. The S135 audit itself (16 agents: independent maps → evidenced diff → adversarial verification of top findings) confirmed 7 of 8 headline divergences and produced `docs/reports/S135-system-report.md`, which M27.1's rebuild sessions are cut from.

## 0.5.54 — 2026-07-26 (Session 134)

- `references/discord-reference.md`: a new **Timestamps** section — **where Discord renders `<t:unix:style>` and where it prints it literally**, the seconds unit, the two-forms pattern, *a duration is not a moment*, and *assert the epoch, not the shape*.
- Evidence: the owner asked for *"Times in discord relative time."* The work was small; the trap was not. Discord resolves the markup in message content, embed descriptions and embed field **values**, and prints the raw string in **select-menu option labels and descriptions, button labels, embed titles, embed footers** and inside any code span. Both the city crime picker and the heist job board render a cooldown in an embed line **and** in a select option **from one shared string** — the obvious in-place edit would have put `<t:1753632000:R>` in front of every player, in the picker, permanently. Those rows now carry two forms (`unavailable` plain, `readyAt` timestamped) and `test/timestamps.test.js` walks every panel payload asserting no `<t:` reaches a component. Same family as 0.5.50: **a component is not an embed, and an assumption that holds for embed text must be re-established for component text.** Two further specifics worth keeping: the unit is SECONDS (`<t:1753632000000:R>` is the year 57000 and renders happily), and `<t:NaN:R>` satisfies `/<t:.*:R>/` while rendering as 1970 — so guards assert the computed epoch. I hit the code-span half myself: the transcript stamp was `` `14:32` `` and my first pass produced `` `<t:…:t>` ``, caught by rendering the line rather than reading the diff. **And 0.5.52 fired again** — my first code-span guard grepped `src/` for a backtick near a `<t:`, which cannot tell a JS template literal from a Discord code span and failed on `!ht`, a command that prints both forms side by side *as its entire purpose*. Deleted rather than loosened, and replaced with a runtime assertion. Second near-miss in three sessions on the same rule, which is an argument for running new static guards against the code they are *supposed* to pass before trusting them.

## 0.5.53 — 2026-07-26 (Session 133)

- `references/architecture.md` (Verification habits): **deleting a command leaves nothing behind that fails** — a removal is the one change with no failure mode of its own, so the deletion commit owes either a name that still points somewhere or a guard that fails while it does not.
- `references/self-improvement.md` (milestone audit): **if the milestone entry names an inventory, diff the inventory before writing COMPLETE.**
- Evidence: the owner reported City/Crime a third time — *"Crime, dat werkt met een panel en knoppen, dat heb je niet."* `!crime` was fine and verified so on both `main` and the commit the Pi was running. The defect was **`!city`**, which S122 removed as an alias of `crime` while reserving the name "for the hub when it exists". Nothing built the hub, **M26.3 was closed as COMPLETE two sessions later**, and because `router.js` drops an unknown command without a word, `!city` answered with silence for **eleven sessions** — no fallback, no hint, no log, no red test, to a command the owner had typed since S90. Two independent failures produced that: a removal that nothing could catch, and a milestone closed against its own written inventory of the source's **eight** views while shipping **seven** — `MainMenuView` was the missing one, named in the same paragraph as the word COMPLETE. The fix for the first is `test/docs-consistency.test.js` (+2): every command name a manual's command table documents must resolve through the loader — 57 names, mutation-proven against S122's exact mistake. The fix for the second is to walk the list. Also from this session's mutation run: two of my own mutations were **broken** rather than surviving (a non-unique anchor, and empty-string filler the code's own `filter(Boolean)` swallowed), which is 0.5.51's warning firing again — and the swallowed filler is what exposed a real bug, the hub's blank separator line being filtered out with the nulls. Four of the session's guards were vacuous on first write: two read a Back button the pump recomputes from the *incoming* id (so a select that drops its origin looks right for exactly one press), and one compared embed descriptions only, letting a `.setFooter()` divergence through. All 18 mutations killed after repair.

## 0.5.52 — 2026-07-27 (Session 132)

- `references/self-improvement.md` + `references/architecture.md`: **a clean sweep is a finding — record it, or it gets re-run** — and its harder half, **do not ship a guard you do not trust just to have a commit.**
- Evidence: S115 audited the games with a component count; S117's correction said that method measures *how a game is driven, not whether it works*, leaving the correctness question open for ten modules across seventeen sessions. S132 closed it on five objectively checkable classes (numeric parameters, stats persistence, leaderboard parity, bare-word invocation, per-module test coverage) and found **no divergence** — which is only useful because it is now written down where the next session will look. Two restraints are the substance: a first attempt at a leaderboard↔stats guard misread `MEMORY_STATS_KEY` (the regex took the first `_KEY` export, a config key), and a brittle static test built on that would have produced false failures and been deleted — **a fragile test is worse than none, and shipping one to have something to commit is scaffolding-as-product in test form.** And M24.3 was left alone: *"go autonomously"* is a mandate to stop asking permission, not to invent content whose own gate is a question about the server that cannot be observed from the container. **When the honest deliverable is "I checked, nothing is wrong, here is the evidence", that is the deliverable.**

## 0.5.51 — 2026-07-27 (Session 131)

- `references/architecture.md` (Verification habits): extends 0.5.46 with its sharpest case — **when a hand-copied list rots for the third time, delete the copy instead of correcting it.**
- Evidence: `STATE.md`'s verification block is the thing that is supposed to catch staleness, and its manuals row named `connect4` — a module deleted **seven sessions earlier** — while omitting the `minigames` that replaced it. S124 had already hand-corrected the other two rows of that same block. The docs themselves were correct; only the check was wrong, which is the worst version: a drifted verification block verifies nothing and gets skipped as "always a bit off". The fix was not a fourth correction but `test/docs-consistency.test.js` (modules ↔ manuals ↔ index, walked from the loader) plus a guard that fails if a literal module list is ever pasted back into that block. `STATE.md` now quotes a count and `npm test` is the verification. Same move as 0.5.46 (the badge map) and 0.5.49 (the shell scripts), now applied to the docs tree. Also worth recording from the mutation run: one mutation appeared to pass when a shell-escaping slip meant it never applied — **"the mutation passed" and "the mutation never ran" look identical**, so confirm the file actually changed before trusting a green.

## 0.5.50 — 2026-07-27 (Session 130)

- `references/architecture.md` (Verification habits): **a permission on a command does not protect the panel that command opens.**
- Evidence: M26.4b added three Manage-Server heist panels. `permission:` on the subcommand gates only who may *type* it — the message it posts is public, outlives the command, and its component interactions arrive carrying nothing but a custom id. Every gated panel therefore needs the check twice, and S130's second check consults an `ADMIN_VIEWS` set rather than a hand-written condition, so a view added later is protected by being in the set instead of by somebody remembering to extend an `if` (0.5.46 applied before it could bite). Generalises to the two facts a pump already had to re-establish — ownership (S98) and staleness — under one rule: a component handler shares nothing with the command but a custom id. Also this session: the loader's duplicate-alias guard caught a collision for the **third** time (S116, S122, S130), which is a decent argument that boot-time invariants belong in tests rather than in review.

## 0.5.49 — 2026-07-27 (Session 128)

- `references/architecture.md` (Verification habits): **the deployment scripts are code, and nothing was testing them** — plus **a test that locates code by searching for a word will find the word in a comment.**
- Evidence: S127 rebuilt the update chain and shipped a bug into `setup-pi.sh` in the same session — markdown backticks inside an *unquoted* heredoc, so bash ran `always`, `on-failure` and `!update` as commands and the owner's install printed four errors. Nothing broke (the unit was still written correctly) but nothing caught it either: after 128 sessions the two files carrying the whole deployment had no test at all, beside 1,303 covering the JavaScript. `test/shell-scripts.test.js` now guards seven invariants. One of those seven was itself vacuous — it located the `CUFFBOT_NO_RESTART` early return by searching for the flag name, which also appears in the header comment, so it measured the comment and passed against a build with the guard moved after the sudo block; fixed by anchoring to the `if` syntax. That is the **fourth** new guard in five sessions to pass against the mutation it existed to catch (0.5.44, 0.5.45, 0.5.47, 0.5.49) — in every case the mutation run was the only reason it was found.

## 0.5.48 — 2026-07-27 (Session 127)

- `references/architecture.md` (Verification habits): **a self-repairing system must not need itself to be working in order to be repaired** — plus the design rule that follows: **count what must exist for a mechanism to work; that count is its failure rate.**
- Evidence: the update chain was repaired in S7, S76, S78 and S120 and failed again every time. S127 diagnosed it from the owner's quoted error text, which was the **pre-S120 wording** — proving the Pi ran code from before the fix and therefore could not fetch it. A deadlock, not a bug. The old chain required four things to exist and match (a service, a timer, a sudoers line matching a command line *exactly*, and a setup step a human had to remember); every failure was one of them missing. The rebuild requires one (`Restart=always`) and **asks** whether it holds rather than assuming — because assuming is precisely how the four previous attempts failed. Also recorded, as a second instance of 0.5.34 rather than a new rule: a watchdog timer was `unref`'d out of habit copied from the repo's pollers, which would have let the hang it guards against outlive it; the test caught it, and the habit had been applied without re-deriving whether its reason applied.

## 0.5.47 — 2026-07-26 (Session 126)

- `references/architecture.md` (Verification habits): **a bounds test must reach the bound, and prove it can.**
- Evidence: S126 caps a displayed success band at 100% and tested it by sweeping the job panel's **first page** — where nothing overflows. It passed against a build with the cap deleted; the job that exceeds 100 at max level (maxSuccess 95, +20 points) is on a later page. Fixed to sweep every page **and** to assert up front that the overflow is reachable, so the guard fails loudly if a table change makes it vacuous instead of passing quietly forever. Third occurrence of one shape in three sessions — 0.5.44 (only the flattering input), 0.5.45 (a fixture too uniform to distinguish), and now a convenient sample of the input space. The common question, worth asking of every new guard: *what input would have to exist for this test to fail, and does it?* Also this session: S114's H1/H2 guard failed the build the moment the port copied the source's `##` headings — the second time in M26 that a rule written down from owner feedback caught a port re-importing the thing he objected to.

## 0.5.46 — 2026-07-26 (Session 125)

- `references/architecture.md` (Verification habits): **a map keyed by something the loader knows should be checked against the loader.**
- Evidence: `core/help.js` holds `COMMAND_CATEGORIES` and `MODULE_BADGES` side by side. The first has been walked against the real loader output since S43 and failed the build the moment S125 added `!tictactoe` without a category. The second had no such test, so when S116 deleted the `connect4` module in favour of `minigames` the stale key survived — the command roster printed a bullet instead of a badge for **nine sessions**, and it was found by reading the file, not by a failure. Two maps, one guarded, and only the unguarded one had rotted. The guard is four lines and belongs in the same commit as the table. Also this session, and worth noting as a second instance of 0.5.34 rather than a new rule: seven mutations were run against new guards before trusting them, catching a tie that keeps the stakes, a settle with no once-only guard (a double *payout*, not just a double stat line), a refund that does not clear its flag, and a failed buy-in that charges the solvent player anyway.

## 0.5.45 — 2026-07-26 (Session 124)

- `references/architecture.md` (Verification habits): **a test that two things share a source needs a source that can tell them apart** — plus **a guard written as a literal list stops guarding the moment the list is right to change.**
- Evidence: S124 narrates a crime's events and then resolves it from the same drawn list; drawing twice would divorce the story from the outcome. The test asserting they match **passed against code deliberately mutated to draw twice**, because the fixture rng always picked index 0 — both draws returned identical events, so identical output proved nothing. Third sibling of 0.5.35 (circular check) and 0.5.44 (only the flattering input): here the fixture was too *uniform* to expose the defect. Fixed with a walking rng and re-verified against the same mutation. Separately, S122's `assert.deepEqual(buttons, ['refresh'])` failed when S124 legitimately added two working buttons; editing the literal would have removed the guard while leaving its shape. Replaced with the rule it stood in for — every offered button must have a handler in the pump — verified by adding a dead button and watching it fail. Both were found because **every new guard is mutated before it is trusted**, which this session applied seven times and which caught one vacuous test and two real defects.

## 0.5.44 — 2026-07-26 (Session 123)

- `references/architecture.md` (Verification habits): **a function whose purpose is to justify a change must be tested against the case where the change is worthless.** Plus, as a second instance: **render the output, not the builders.**
- Evidence: `batchingSaving` exists to quantify how much batching short voice turns saves against Groq's 10-second minimum billing. Its first version computed the unbatched cost as `turns × 10` — treating the floor as a flat rate — so a 12-second turn was priced at 10 instead of 12 and the saving was overstated for long turns. The error was in the exact function whose job is to justify the change, pointed only at the flattering input. The corrected version reports factor 1 for three 12-second turns and a test asserts it. Sibling of 0.5.35: there the check was circular, here it was only ever aimed at the case that made the change look good. Separately, `!transcribe` had printed its **Auto-join** line twice since S118 — every test asserted a line-producing function in isolation, none asserted the finished status.

## 0.5.43 — 2026-07-26 (Session 121)

- `references/architecture.md` (Verification habits): **a number shown to a user must carry its unit and its window.** Riders: when an argument's unit depends on *another* argument the usage line cannot express it, so the description and the reply must; and **a default sized for one workload silently becomes wrong when a second workload starts spending it**.
- Evidence: the owner asked whether transcribe's `100` meant minutes, seconds or messages — the status said `3 / 100 transcribed`, and nothing named the unit or the reset. Reading the accounting to answer him surfaced the larger problem: `spendBudget` charges 1 per call regardless of length, and a live-voice *turn* costs the same as a memo, so 100 is ~10–25 minutes of conversation. The default was chosen in S101 when memos were the only spender; S110's auto-join changed what it buys without anyone re-sizing it. Same shape as 0.5.42's stale timeout, one layer up: a number that was right when written and was never re-examined when its meaning changed. The manual's config row said "Transcriptions per UTC day" all along — **a doc row is not a substitute for the interface saying it**.

## 0.5.42 — 2026-07-26 (Session 120)

- `references/architecture.md` (Verification habits): **a safety fallback that succeeds hides the failure it covers for.** Make fallbacks audible — log which path was taken and why — or a permanently degraded system stays permanently silent. Plus: **a timeout sized against a workload goes stale as the workload grows**; write down what it was sized against.
- Evidence: `!update`'s preferred path ran `sudo -n systemctl start --no-block cuffbot-update.service` while the sudoers rule permitted `systemctl start cuffbot-update.service`. sudo matches the whole command line, so the rule never matched and sudo refused **every time since S7** — invisible, because the bash fallback always worked. Separately, the 3-minute poll limit was set when the suite was ~350 tests with no dependencies; at 1,095 tests plus `npm install` a healthy Pi update timed out and was announced as *"the updater never ran"*, sending the owner to re-run `setup-pi.sh` twice for nothing. Fixing the flag also required fixing the fallback trigger: without `--no-block` a `Type=oneshot` start blocks until the update finishes, so "any non-zero exit → fall back" would have re-run a rolled-back update in full.

## 0.5.41 — 2026-07-26 (Session 118)

- `references/architecture.md` (Verification habits): **a silent refusal path needs a way to ask it why.** Staying quiet in the channel is usually right for a background feature; being unable to say afterwards which branch fired is not. Expose the decision — and the fix for it — in the module's bare status line.
- Evidence: the owner reported *"de bot joint niet automatisch de VC"*. Driving the real handler showed every condition passing, so the code could not be blamed and could not be cleared either: auto-join has six silent `return`s (off, disabled, out of scope, no key, no Connect, no Send Messages) and nothing distinguished "not deployed" from "no permission" from "no key" — for the owner or for me. The fix was a status line, not a code change. Same shape as 0.5.37 (*owner-action items are checks, not instructions*) pointed at code instead of docs: both concern state that only exists outside the repo, and both are answered by making the bot report it.
- Also recorded: **"cannot reproduce" is a finding, not a dead end.** The pull is to change something so the session has a fix to show; the useful output was making the absence of evidence impossible next time.

## 0.5.40 — 2026-07-26 (Session 117)

- `references/architecture.md` (Verification habits): **a sweep only inspects what it is changing — whatever already looks like the target shape is invisible to it.** After a sweep, enumerate every member of the target *category* and check it, not just the items the sweep edited. Turn that enumeration into a test so the category stays checked.
- Evidence: two instances, both found by the owner playing the bot rather than by any review. S106 introduced `invokeWithoutSubcommand` while folding flat commands into groups; seven game modules were already groups (S72–S83), so the sweep never examined them and `!hangman`, `!wordle`, `!memory`, `!rollout`, `!russianroulette`, `!splitorsteal` and `!guessthecandy` all answered with a menu where their source cogs start a game (*"hangman werkt niet zoals het hoort"*). S115 found the same shape for panel-driven ports. The enumeration written this session immediately turned up an eighth defect nobody had reported — bare `!dispatch` answering with a usage error — which is the argument for writing it as a test rather than a one-off audit.
- Also recorded, against 0.5.38: **S115's audit called hangman "faithful" on evidence that only supported "same interaction model."** Counting `discord.ui` references measures how a game is *driven*, not whether it *works*. State what the method actually checked.

## 0.5.39 — 2026-07-26 (Session 116)

- `references/architecture.md` (Module pattern, next to 0.5.32): **the loader's invariants are part of the slicing constraint — check them while planning slices, not while running tests.** Every module directory needs an `index.js`, and command names *and aliases* are unique across all modules. So **"build the replacement alongside the original" is not a slice that exists in this codebase**, and neither is a `lib/`-only module.
- Evidence: twice now a session has planned a slice the loader forbids. S105 planned an engine-only mafia slice and hit the `index.js` requirement (recorded then as a fact about that one file). S116 planned to keep the old `connect4` module alive until 26.2b "so nothing regresses mid-way" — both modules register `!connect4`, the uniqueness check failed, and the old module had to be deleted a slice early. That in turn would have removed the precinct's scoreboard, so stats had to be pulled forward too: one unenforceable plan assumption cascaded into re-scoping two slices.

## 0.5.38 — 2026-07-26 (Session 115)

- `references/architecture.md` (Module pattern, extending 0.5.32): layer-slicing a staged port has a **second and larger** cost than the mechanical one already recorded. When the source is panel-driven, an intermediate command surface built as scaffolding **becomes the product** — it is genuinely usable, so every later slice adds features to it, and the panel is never dropped so much as never scheduled. **When a staged port's source is panel-driven, the panel belongs in the first slice a player can touch.**
- Evidence: S115's audit (M26.1) of all 13 games. Nine match their source's interaction model; the two that do not are exactly the two largest ports — heist (4 sessions, 8 source panels, we built 1) and city (4 sessions, 48 source UI refs, we built 0) — and both were sliced *engine → storage → commands → extras*. The owner found city by playing it: *"dat werkt met panelen niet enkel met commands."* City's `CrimeAttemptView` has a `Bail Out!` button live during an attempt, so what went missing was gameplay, not decoration. 0.5.32 already warned against layer slicing, but its stated reason was that the loader needs an `index.js` — a reason that does not predict this failure at all.

## 0.5.37 — 2026-07-26 (Session 113)

- `SKILL.md` Step 6 (Record): **an owner-action item must be written as a check, not an instruction.** Name the command whose output settles it, and run that command before ever repeating the item.
- Evidence: STATE's *Owner actions pending* list was phrased as "do X" and could only be cleared by the owner volunteering that he had done it. The state that would clear it lives on a Discord server no session can see, so it never got cleared — and every session re-read the list and re-issued it verbatim. The owner was told four times to run `!ranks setup` (he had run it four times) and once to add an API key he had already added: *"Nog een keer de leveler? dat heb ik inmiddels 4x gedaan, die API key staat er ook al in."* This is the second time the shape has cost real irritation — S57 produced a "stop repeating this" mandate about intents, which patched that one instance rather than the pattern. A to-do list addressed to a human is a claim like any other, and it is the kind that decays silently.

## 0.5.36 — 2026-07-26 (Session 112)

- `SKILL.md` Step 2 (Verify): **`ROADMAP.md` is a claim too.** Iron rule 2 named `STATE.md` and `SESSION_LOG.md` and quietly excluded the third state file — so nothing told anyone to verify the roadmap, and nobody did. Adds the two drift shapes (an unchecked-but-done box schedules duplicate work; a checked-but-undone box hides a gap), the fastest tell (**a parent box unchecked while every child is ticked is stale**), and the requirement that a box blocked on the owner says so inside the box.
- Evidence: S112 read the roadmap to pick the next item and found four milestones unchecked with all their sub-slices ticked — M16.14, M17.3 (whose own acceptance line read *"✅ Done in S96"* directly beneath an empty box), M24.1 (S105) and M24.2 (S108) — plus a *"not yet scheduled"* heading four sessions after the owner scheduled it. Step 3 says to take the first unchecked item, so the next session would have started rebuilding `src/modules/mafia/`. Five sessions of owner-requested work (S106, S107, S109, S110, S111) also had no roadmap entry at all, making them invisible to anyone planning from that file.

## 0.5.35 — 2026-07-26 (Session 111)

- `references/architecture.md` (Verification habits): **a check that derives its expected value from the thing under test cannot fail.** Restate the truth independently — from the owner's message, a fixture, or a literal typed out a second time. Includes the concrete trap that produced it: a Discord snowflake is a string, always.
- Evidence: S111 committed the owner's four voice→text channel pairings as an object literal with unquoted 18-digit keys. `Number` cannot hold `411633952961593345`; it silently became `411633952961593340`, so the map could never have matched a real channel — and nothing throws, the source looks correct, and the diff looks correct. **The verification returned a false green**: it iterated `Object.entries()` and looked each key back up, which reads the already-rounded key and compares it with itself. This is 0.5.34 (*verify the verification*) narrowed to its most common concrete shape — the tautological check — which is worth naming separately because the previous three instances were all *wrong* checks, and this one was a *circular* one.

## 0.5.34 — 2026-07-26 (Session 107)

- `references/architecture.md` (Verification habits): **verify the check before believing its result** — and when a check passes, make sure it *could* have failed.
- Evidence: three instances in eight sessions, which is what promotes it from a hunch to a rule. S100: fixtures that asserted the wrong answer, so a red test told a confident story about a bug that did not exist. S106: a regex that extracted nothing, and "nothing" was indistinguishable from a legitimate empty value — a false green. S107: a clean-checkout simulation that ran `git init` instead of `git clone`, so `packaging.test.js` failed for a reason that could not happen on the Pi (a false red), and a behaviour assertion that truncated its input to 160 characters before matching (a false red on correct code). The operative half of the rule: **when a check disagrees with code that has independent evidence behind it, suspect the check first.**

## 0.5.33 — 2026-07-26 (Session 106)

- `references/architecture.md` (Verification habits): **a mechanical refactor must be audited field-by-field against the pre-change source, not spot-checked.** A regex that fails to match produces *silence*, and silence is invisible in a diff.
- Evidence: S106 folded 19 hyphenated commands into Red-style groups with a Python helper. Its `args:` regex did not allow a trailing comment, so four modules lost their arg specs entirely — `args: []` looks exactly like a command that legitimately takes none, so nothing in the diff or the code review would show it. `!dispatch locker set` stored nothing; `!donuts @member` ignored the mention. The fix that found it was reading every folded subcommand's original back out of `git show HEAD:<file>` and comparing field by field; the repair regex then over-matched and gave three subs their neighbour's args, which the same audit caught on the second pass. Both rounds were found by comparing against the source of truth, never by reading my own output.
- Also recorded, as a second confirmation of the S93 rule (*check what the instruction would literally do to the user*): the conversion needed Red's `invoke_without_command` before it was safe, or bare `!trivia` would have stopped starting a round.

## 0.5.32 — 2026-07-26 (Session 105)

- `references/architecture.md` (Module pattern): **slice a staged port by feature depth, not by layer.** "Pure logic this session, command surface next session" is not an available slice for a NEW module — the loader requires an `index.js` manifest for every directory under `src/modules/`, so the pure half has nowhere legal to live.
- Evidence: S105 planned M24.1 as an engine-only slice and hit exactly that wall — a `src/modules/mafia/` with only `lib/` fails `discoverModules`. Heist (S85–S88) and city (S89–S92) got away with layer slicing because they were slicing *within* a module that already had a manifest. The slice that does work is depth: Classic mode now, the other 53 roles later, each stopping cleanly with a playable game.

## 0.5.31 — 2026-07-26 (Session 102)

- `references/architecture.md` (Verification habits): **a binary format must be verified against a foreign implementation.** Your own reader accepting your own writer is self-consistency, not evidence. Do the cross-check once in the session that writes the encoder and record it; keep an independently-written reader in the committed suite. Also: before planning around a library helper, check the *installed* version actually has it.
- Evidence: S102 wrote an Ogg/Opus muxer so live-voice transcription needs no audio decoder. Ogg's CRC is its own variant, and the plausible wrong answer (zlib's CRC-32) produces bytes that pass every structural check while every real decoder rejects them — a failure with no error anywhere in our own stack. Running the output through **mutagen**, an unrelated implementation, gave byte-identical re-serialised pages and a duration matching to the millisecond, which is what actually proved the CRC, the granule and the pre-skip. The sibling half of the rule was earned in the same session: the plan was to use prism-media's `OggLogicalBitstream`, and checking the installed tree first revealed `@discordjs/voice` bundles prism-media 1.3.5, where that class does not exist. Checking cost a minute; discovering it on the Pi would have cost a red update gate.
- Filed next to 0.5.29's fixture rule deliberately — both are the same principle: do not let your own code be the only witness.

## 0.5.30 — 2026-07-26 (Session 101)

- `SKILL.md` (Step 3 Plan): **a blocking owner decision is the current session's job to ask, not the next session's.** Put the options in front of the owner with their real costs, then keep building the unblocked work while the answer comes back. Forwarding the flag is not handling it.
- Evidence: M21 was marked "needs an owner decision before any code" in S97 and that flag was faithfully carried through S98, S99 and S100 — four sessions that each recorded the block in their handoff and each moved on. S101 asked, got an answer in one exchange, and the answer immediately dissolved half the problem: the owner's chosen backend was **already an env var the project expects**, which made the voice-memo half zero-dependency and shippable the same session. Four sessions of deferral kept nobody from learning that. The rule is deliberately paired with the existing "owner decisions become committed defaults" (S35) and "chat does not survive sessions" (S1–S3): ask, then write the answer into the repo.

## 0.5.29 — 2026-07-26 (Session 100)

- `references/architecture.md` (Verification habits): **hand-written state fixtures are guesses until the code confirms them** — a constructed state may be unreachable, and the answer you wrote down may not be the only correct one. Compute the expected answer from the code under test, build the fixture the way the system builds state, and check a suspect fixture with a throwaway one-liner before believing a red test.
- Evidence: S100 built the Connect 4 solo opponent, whose whole suite is fixed positions. Three fixtures were wrong before any code was: a "diagonal threat" that was an already-completed win; a tie board whose single gap sat at the *bottom* of a column, a position the game cannot reach and which `legalMoves` rightly called full; and — once the diagonal was rebuilt — a position with **two** winning columns, making the hand-written single answer arbitrary. Each red test told a confident story about a bug in `chooseMove`; all three times the implementation was correct. The rewrite that fixed it is the rule: `winningColumns(board, disc)` computes the set and the test asserts membership, so the fixture can no longer lie about what it is.

## 0.5.28 — 2026-07-25 (Session 99)

- No rule added. Recording the confirmation instead: S99 built the chat kill counter — a feature whose entire substance is a 30-second timing rule — and the existing guidance carried it unchanged. Pure logic in `lib/` with an injected `now`, plus injectable timers, meant all 27 tests run instantly rather than a suite that would take minutes and flake. Those rules came from S73/S79/S81 (the io-injected game engine) and needed no adjustment for a non-game feature, which is evidence they generalised correctly.
- Kept as an entry because SKILL.md is right that finding nothing is suspicious: the check ran, and this is the reason it came back empty.

## 0.5.27 — 2026-07-25 (Session 98)

- `references/architecture.md`: recorded the **non-originator press** rule for public component messages — three honest answers (update in place / answer privately / refuse visibly), chosen by whether the content is per-viewer, and never a silent mutation of someone else's message.
- Evidence: S98 built the button help menu and had to answer this from scratch even though S95 had answered it for the patrol wizard weeks of sessions earlier. Help is permission-filtered per viewer, so a stranger's press must not edit the asker's message (it would rewrite what they are reading) and must not show them the asker's roster (it would leak which commands that member can use) — hence the private, keyed-to-them view. CuffBot now has four component features (trivia, patrol wizard, selfroles, help); two independent arrivals at the same question is what makes it worth writing down.

## 0.5.26 — 2026-07-25 (Session 97)

- `references/architecture.md`: named the **published-post pattern** — a bot-owned message the bot edits in place — with its four hard parts (tracked id ARRAY, surplus deletion, re-post on a failed fetch, old-channel cleanup on a move) plus the per-guild lock.
- Evidence: S97 built the M18 rules publisher and found it was the same problem selfroles solved in S59/S64 — tracked ids, growing past one embed, a human deleting the bot's message, a channel move leaving two copies. Reusing that shape made the build minutes rather than a session, and each listed edge case exists because it bit once. A third instance is plausible any time the owner asks for "one tidy post that stays current", so the pattern is worth recognising rather than rediscovering.

## 0.5.25 — 2026-07-25 (Session 96)

- `references/architecture.md` (Module pattern): the command-shape section now describes **two** shapes, not three — the legacy `{ data, execute }` paragraph is replaced by one line of history. Added the deletion rule: **a migration is not finished when the last caller is converted; it is finished when the scaffolding is gone**, and plan that final slice from the start.
- Evidence: S96 closed M17.3 by deleting `prefix/adapter.js` (167 lines), `assignOptions` and its slash-option machinery (`parse.js` 172 → 47 lines), the router's and loader's legacy branches, `index.js`'s `runCommand` wrapper, `summarizeCommand`'s legacy branch, the mixed-window `replyEither` shim, `ensureInvokerPermission`, and the adapter's whole test file. The test count went **790 → 769** and that drop is the evidence, not a regression: those tests described a translation layer that no longer exists. Without a planned deletion slice the layer survives indefinitely, and every future session pays to reason about it — which is exactly what STATE said about this adapter for 27 sessions before M17.3 was sliced.

## 0.5.24 — 2026-07-25 (Session 95)

- `references/architecture.md` (Module pattern): added the sibling of S94's advertised-syntax rule — **a feature gated on a "which surface am I?" test is a time bomb; grep for those tests during a conversion and re-decide each one**, and give any "temporarily disabled" branch a test asserting the disabled behavior so removing it is a visible change.
- Evidence: S95. `!patrol-wizard` checked `interaction.isTextCommand` and bailed with "being rebuilt for text-only mode (S69)". S68 then made *every* invocation a text command, so the wizard died at that moment and stayed dead for eleven sessions — invisible, because a command that always answers with a polite notice looks alive, and its one test asserted exactly that notice. Nothing about it needed a slash command: components attach to a message, and the module's own InteractionCreate pump handles them either way.
- The same session confirmed S94's rule twice more: `!evidence-locker action:set` (advertised in two manuals and in `!911`'s reply) had also never worked on the text path, and the trivia manual told readers to run `deploy-commands` to register a question set — a script S68 repurposed to CLEAR the slash roster.

## 0.5.23 — 2026-07-25 (Session 94)

- `references/architecture.md` (Module pattern): extended the S93 conversion rule with its missing half — **before converting a command, grep the docs AND the bot's own replies for how it is advertised, then make that string work.**
- Evidence: S94. `!rank-setup header:@[LEVELER]` is printed in four manuals, in STATE's owner-action list and in three of the bot's own command replies, and has been the owner's #1 pending action since S12 — and it had never worked on the text path. The legacy adapter was purely positional, so `header:<@&…>` answered "`header` should be a mention or id". S68 made the bot text-only; nobody re-checked the syntax the docs kept promising, and 26 sessions passed. A conversion is the one moment the promise and the parser are read side by side, so that is where the check belongs. Fixed generally: the framework now supports `name:value` keyword args.
- Second evidence for the same rule, smaller: converting `!cite` surfaced an S93 regression where an optional trailing STRING claimed a token from the tail (`!cite @x Donut theft` → reason "Donut", penalty "theft"). The legacy parser had an explicit guard against it that the S93 rewrite dropped. Recorded in the reference so the next reimplementation keeps it.

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
