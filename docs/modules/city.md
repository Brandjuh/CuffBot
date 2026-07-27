# City — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable — the staged port is complete (S89–S92), panel-driven since S122/S124, hub since S133
**Last updated:** Session 134 · 2026-07-26

## Purpose

The street level of the precinct's underworld: City, ported from CalaMari-Cogs/city (owner request, S65 batch → M16.13). Members attempt crimes — picking a pocket, mugging someone, robbing a store, hitting a bank — each with its own odds, payout, cooldown, fine and jail sentence. Every attempt draws random events that swing the odds, the take and the sentence, and consecutive successes build a streak bonus.

The cog is ~7,000 lines, so it lands in slices, using the shape that worked for heist:

| Slice | Contents | Status |
|---|---|---|
| **A** | Crime table, the 96 events, the pure resolver | ✅ S89 |
| **B** | Storage + the `!crime` command surface | ✅ S90 |
| **C** | Jail, bail, jailbreak + the 46 random scenarios | ✅ S91 |
| **D** | Black market, leaderboards, admin surface | ✅ S92 |

All four slices are in: four crimes plus 46 one-off scores, random events, streaks, fines, sentences, bail, a one-shot jailbreak, a black market, six leaderboards and an admin surface.

## The panel (M26.3a)

Owner: *"Dit is niet hoe het spel werkt in de link die ik je stuurde, dat werkt met panelen niet enkel met commands."* He was right — S115's audit measured the source at **48** `discord.ui` references against our **0**, the largest divergence of any game in the repo.

**`!crime` now opens a panel**: your wallet and streak, a select menu of the jobs with reward, risk and cooldown on each row, and the buttons that fit your situation. Jail replaces the picker entirely with **Pay Bail** and **Jail Break**, because those are the only two choices that exist there.

A job on cooldown stays **visible but unselectable**, showing `⏳ wait 4m 00s`. Hiding it would make the list change shape between glances, and the wait is more useful than an absence.

### Bail Out — the mechanic that did not exist

This is why the divergence was a **gameplay** problem and not a navigation one. The source puts a `Bail Out!` button on screen *while the crime is resolving*: pick a job, watch it start, and you have a moment to walk away for a flat **100 🍩**. The cooldown still burns — that is the price, and without it Bail Out would be a free re-roll.

A command-only surface has nowhere to put that decision, so for four sessions it simply was not in the game.

## The crime plays out (M26.3b)

S122's Bail Out lived for one 2-second beat, because the resolver drew its events and settled in the same call. **It now plays out**, the way the source does:

| Beat | Wait | What the player sees |
|---|---|---|
| Opening | 2 s | *"@you is running the bank heist…"* |
| Each drawn event | 4 s each | *"You spotted a security guard nearby! 🚔 (-15% success chance)"* |
| Suspense | 4 / 5 / 6 s by risk | *"This is it…"* |
| Verdict | — | the result card, buttons gone |

**The bail flag is checked before every beat.** A four-event bank job therefore offers six chances to walk away, and each one comes *after* you have learned something — which is what makes the 100 🍩 a decision rather than a coin flip on a timer.

The whole crime happens on **one message**, edited in place, so the Bail Out button is always directly under the latest thing that happened. (The source posts a message per event and deletes them afterwards.)

> **Invariant, tested:** the slowest possible crime (every event the draw can yield, plus the high-risk suspense) is **24 s**, inside the button's own **30 s** lifetime. If a script could outlast the button, the last beats would be narrated under a dead Bail Out. `worstCaseDurationMs()` is computed from `EVENT_CHANCES` rather than a hard-coded event count, so adding a fifth draw step breaks the test instead of the game.

The narrator draws the events and hands **the same list** to the resolver. Drawing twice would mean the story you watched and the outcome you got came from different crimes; a test asserts the result card lists exactly the events that were narrated.

## Picking a mark (M26.3b)

`pickpocket` and `mugging` need a victim. The panel used to answer *"that one needs a mark, run `!crime pickpocket @member`"* — sending you back out to the text surface the panel exists to replace. It now asks:

- a **user select menu** (the source uses a modal you type a name into; a picker cannot be misspelled),
- **🎯 Random Target**, which skips bots, you, anyone in a cell, anyone carrying less than `max(minStealBalance, crime.minReward)`, and **your previous victim**,
- **✖️ Cancel**, which returns to the panel.

The last-victim rule only applies to the roll, not to a name you chose yourself — refusing a deliberate pick is a different thing from refusing to roll it. And when the *only* eligible mark is your last one (a small guild), the roll allows the repeat rather than refusing to play.

The roller shuffles the member list before capping it at 60, so one button press cannot read a whole guild's balances and the roll stays fair across everyone rather than always drawing from the same alphabetical prefix.

## Market and board, on the panel (M26.3b)

Both are now buttons on the panel — **including in jail**, because buying a Get Out of Jail Free card is exactly what a jailed player wants the market for.

- **🕯️ Market** replaces the panel with the shelf plus a **buy select**, so purchasing is one press instead of `!crime buy <item>`. When everything is owned or unaffordable the menu is disabled rather than accepting a press it would only refuse.
- **🏆 Board** shows the leaderboard with a category switcher that re-renders in place.
- **◀️ Back** returns to the panel from either.

S122 deliberately left these buttons off because they had nowhere to go — that was the scaffolding-as-product trap avoided, not a permanent decision. The test that guarded it was a hard-coded `['refresh']`, which a literal list cannot express; it now asserts the real rule instead — **every button the panel offers is an action the pump handles** — which survives the next slice adding one.

## The hub (S133)

Owner, third report: *"Crime, dat werkt met een panel en knoppen, dat heb je niet."*

`!crime` did have its panel — that part shipped in S122 and was verified working, on the deployed commit as well as on `main`. What did not exist was **`!city`**, and it did not exist in the worst possible way.

S122 removed `city` as an *alias* of `crime` — correctly; the owner had noticed the two were one command (*"de spellen Crime/city zijn hetzelfde"*), and in the source they are two. It wrote that this "leaves `city` free for the hub when it exists". No session built the hub. M26.3 was closed as **COMPLETE** two sessions later. And because the router drops an unknown command without a word — `router.js`: `if (!command) return` — `!city` did not degrade to the crime panel, print a hint, or log anything. It did **nothing at all**, for eleven sessions, to a command the owner had typed since S90.

`MainMenuView` is, tellingly, the one view in M26.3's own inventory of the source's `crime/views.py` with no CuffBot counterpart: `CrimeListView`, `BailView`, `JailOptionsView`, `TargetSelectionView`, `BlackmarketView` and `CrimeAttemptView` were all built in S122 or S124.

**`!city` now opens the hub** — wallet, record, streak, cell — with four buttons: **🌃 Jobs** (the crime panel), **🕯️ Market**, **🏆 Board**, **📋 Record**. It reads deliberately short (≤ 6 lines, pinned by a test): a menu is the one screen with nothing to say, and the owner has twice said these screens run too long.

The crime panel gained a **🌆 Streets** button on both views, so the hub is one press away from the board rather than a command you have to remember.

**Back now returns where you came from.** The market's and board's Back was hard-coded to `cty:refresh`, so opening the market from the hub dropped you on the jobs board — a Back button leading somewhere you had never been. The origin rides in the custom id (`cty:market:hub:<owner>`), which is the same trick the panel already used for the owner id, and it survives switching leaderboard category and buying an item.

`!crime stats` and the Record button render **one** card from one builder. A panel view drifting from the command it replaced is exactly the shape of the M26 complaint, so a test pins that they stay identical.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!city` | **The hub** (S133): where you stand, and four buttons — Jobs, Market, Board, Record | none — everything is a button | Everyone | `!city` |
| `!crime` | Group: four crimes plus your record; bare = **the jobs board panel** | subs below | Everyone | `!crime bank` |

### !crime (S69-style group)

| Subcommand | Does |
|---|---|
| `!crime pickpocket <@member>` (aliases `pick`, `pocket`) | Lift 1–10% of a member's donuts — 60%, 10-minute cooldown, 1 hour inside if caught |
| `!crime mug <@member>` (alias `mugging`) | Take 15–25% — 60%, 30-minute cooldown, 90 minutes inside |
| `!crime store` (aliases `rob`, `rob_store`) | 500–2000 🍩 at 50% — 6-hour cooldown, 3 hours inside |
| `!crime bank` (aliases `heist`, `bank_heist`) | 1500–5000 🍩 at 40% — once a day, 4 hours inside |
| `!crime random` (aliases `lucky`, `scenario`) | One of **46 one-off jobs**, each with its own odds, payout, sentence and story |
| `!crime bail` | Buy your way out — the price tracks what is *left* of your sentence |
| `!crime jailbreak` (aliases `break`, `escape`) | One shot per sentence: walk free, or add 30% to your time |
| `!crime market` (aliases `blackmarket`, `shop`) | The black market: a permanent lighter sentence, or a card straight out of a cell |
| `!crime buy <item>` | Buy from it |
| `!crime usepass` (alias `pass`) | Burn a Get Out of Jail Free card |
| `!crime leaderboard [category]` (aliases `board`, `top`) | Six boards: earned, biggest, jobs, stolen, fines, streak |
| `!crime admin [setting] [value]` | **Manage Server:** bail on/off, bail price, steal limits (bare = show) |
| `!crime stats [@member]` (alias `record`) | The criminal record: jobs, success rate, earnings, fines, what you took and lost, streaks, and your kit |

- **The gates fire in the cog's order:** jailed → cooling down → target checks. A targeted crime refuses a bot, yourself, and anyone carrying less than `max(minStealBalance, the crime's minReward)` — the cog will not let you rob someone who has nothing worth taking.
- **Every attempt draws events** (one guaranteed, then 75% / 50% / 10%) that shift the odds, multiply the take, stretch or shorten the sentence, or hand you loose change. They are all printed on the result card, and a win shows the arithmetic step by step.
- **Money is real:** payouts, fines and steals all move donuts through the economy. A steal is capped at what the victim actually holds, and both sides' records are updated.
- **The black market** sells two things. **Reduced Sentence** (20,000 🍩) is a permanent perk that takes 20% off every sentence *as it is handed down*; **Get Out of Jail Free** (1,000 🍩) is a card that ends a sentence on the spot and restores your jailbreak attempt. **Recorded deviation:** the cog's third item — a 10,000-credit "ping me when I'm released" perk — is **not** sold, because our jail has no release timer at all (a sentence is evaluated whenever you next act), so it would take money for nothing.
- **Getting out:** bail costs `int(1.6 × minutes left)`, so waiting makes it cheaper, and it clears your record's cell. A jailbreak draws one of 14 scripts whose events all apply — they shift the odds and can cost or pay a little — then one roll decides: free, or **30% added to whatever was left**. You get exactly one attempt per sentence, claimed before the roll so a crash cannot buy you a second.

## Events

`events/panel.js` — one `InteractionCreate` listener for every `cty:`-prefixed component. (The claim "None — the crime resolves the moment you run the command" stood here until S124; it was already false when S122 added the panel.)

| Custom id | What it does |
|---|---|
| `cty:refresh:<user>` | Re-render the panel — also the Back and Cancel buttons |
| `cty:pick:<user>` | A job was chosen from the select |
| `cty:mark:<crime>:<user>` | A victim was chosen from the user select |
| `cty:roll:<crime>:<user>` | 🎯 Random Target |
| `cty:bail-out:<crime>:<user>` | Walk away mid-attempt for 100 🍩 |
| `cty:bail` / `cty:jailbreak` `:<user>` | The two jail actions |
| `cty:market:<user>` / `cty:buy:<user>` | Open the shelf / buy from it |
| `cty:board:<user>` / `cty:board-cat:<user>` | Open the board / switch category |

The owner's id rides in the custom id, so a press is attributable **without keeping panel state in memory across a restart**. The panel is a personal board, so it has exactly one owner: a stranger's press is answered privately with a pointer to `!crime` for their own, rather than silently doing nothing.

## Configuration

- `cityMembers` in the guild store, keyed by member: `{ cooldowns {crime: startedAt}, jailMs, jailStartedAt, attemptedJailbreak, streak, highest, lastCrimeAt, stats {successes, failures, finesPaid, earned, largestHeist, stolenFrom, stolenBy, bailPaid} }`.
- `citySettings`: the cog's `global_settings` (bail multiplier 1.6, minStealBalance 100, maxStealAmount 1000, default sentence 30 min) — sparse, with the admin surface landing in slice D.

## Permissions & safety

- **Member permissions:** everything is public, like the cog.
- **Economy:** every payment goes through the economy module's `adjustBalance` seam with a lazy import and a try/catch (the S8 rule).
- **Victims:** a steal never exceeds the victim's balance, nobody can be pushed negative, and the victim's own record logs what was taken. Bots and self-targeting are refused.
- **Pings:** none — the result card names the victim without notifying them.

## How it works

- `lib/tables.js` — the five crimes with the cog's numbers (`pickpocket` 150–500 at 60% / 10 min cooldown / 1 h jail; `mugging` 400–1500 at 60%; `rob_store` 500–2000 at 50% / 6 h / 3 h; `bank_heist` 1500–5000 at 40% / 24 h / 4 h; `random`, whose numbers each scenario overrides in slice C), the `global_settings` defaults, and the streak rules. Where the cog's comment and its value disagree (`rob_store`'s fine says "45%" but is 0.4) the **value** wins, pinned in a test.
- `data/crime-events.json` — the **96 events, 24 per crime, dumped straight out of the Python source** rather than retyped. There is no transcription step to get wrong; the test validates the shape (every event has display text and at least one real effect, and only known effect keys appear).
- `service.js` (slice B) — the criminal record over the store, the gates (`jailState`, `cooldownFor`, `canAttempt` in the cog's order) and `commitCrime`, which resolves an attempt, clamps a steal to the victim's balance, moves the donuts both ways and writes both records.
- `commands/crime.js` — the group and the result card, which fills in the events' `{credits_bonus}` / `{currency}` placeholders and prints the reward steps the resolver returns.
- `lib/market.js` (slice D) — the two items and `applySentenceReduction`, the cog's 20% shave; `service.js` adds `buyMarketItem`, `useJailPass`, the perk/consumable inventory on the member record, and `cityLeaderboard` over six categories.
- `lib/scenarios.js` (slice C) — the **46 random-crime scenarios and 14 prison-break scripts, both dumped from the Python** like the events. The cog wrote their numbers as module constants (`RISK_MEDIUM`, `SUCCESS_RATE_LOW`…), so the dump resolved those names first. `scenarioToCrime` maps a scenario onto the crime shape the resolver already accepts — it overrides reward range, odds, sentence and fine, and keeps the `random` crime's cooldown. `resolveJailbreak` is pure: **every** event in a break script applies (there is no probability draw, unlike a crime), then one roll.
- `lib/resolve.js` — pure. `drawEvents` (first guaranteed, then 75% / 50% / 10%, drawn without replacement), `applyEvents` (chance bonuses clamp at 100%, penalties at the cog's 5% floor; jail multiplies cumulatively with truncation at each step; direct credit effects sum separately), `nextStreak`/`streakBonus` (+5% a step, capped at +25%, wiped after 24 idle hours), `stolenAmount` (a random slice of the victim capped by the settings *and* the crime's own ceiling, floored at its minimum when the victim can cover it), and `resolveCrime`, which ties it together.
  - **The rounding order is the behavior**: on a success the cog rounds after the streak multiplier and then again after *every* event multiplier — not once at the end — so the port does the same, and reports each step for the result card slice B will draw.
  - On a failure the fine is `int(maxReward × fineMultiplier)`; a member who cannot pay it loses everything they have **and serves double** (the cog's rule).
  - A targeted crime's whole transfer — reward plus event credit effects — comes out of the victim, matching the cog; a first draft of this port split them, and the test caught it.

## Files

```
src/modules/city/
  index.js                 manifest
  lib/tables.js            5 crimes, settings defaults, streak + event-draw rules
  lib/resolve.js           the pure resolver: draw → fold → roll → pay or jail
  service.js               the record, the gates, the money, bail + jailbreak
  lib/scenarios.js         46 scenarios + 14 prison breaks, and their resolvers
  lib/market.js            the black market's two items + the sentence perk
  lib/panel.js             the pure panel: picker rows, buttons, bail, mark prompt
  lib/narrate.js           the pure beat script: timings, event text, story so far
  lib/targets.js           who can be robbed, and the random-mark roll
  attempts.js              live attempt flags (own module: breaks an ESM cycle)
  events/panel.js          the `cty:` component pump
  commands/crime.js        the !crime group, the result card, the panel payloads
  data/crime-events.json   96 events, dumped verbatim from the source
  data/scenarios.json      46 one-off crimes, dumped (constants resolved)
  data/prison-breaks.json  14 escape scripts with their own events, dumped
test/city.test.js          tables, event pool, draw, modifiers, streaks, attempts
test/city-service.test.js  record, gates, payouts, victim clamp, card, group shape
test/city-panel.test.js    picker rows, button sets, bail cost, wait formatting
test/city-narrate.test.js  the beat script, the bail-window invariant, the story
test/city-targets.test.js  target eligibility, refusal messages, the random roll
test/city-attempt.test.js  the narrated attempt end to end, market/board payloads
```

## Testing

- `test/city.test.js` (11 tests): the crime values (including the comment-vs-value case), the 96-event pool's integrity and key set, the draw (four distinct events when every roll lands, one when none do, the `0.75` boundary, and no rng calls at all for a crime with no pool), the modifier folds with both clamps, the streak ladder and its 24-hour expiry, all five steal branches, a scripted success proving the two-stage rounding, a failure with its fine and folded sentence, the broke-and-doubled path, a targeted success, and the cooldown/jail/bail helpers.
- `test/city-service.test.js` (11 tests): the record's shape and round-trip, settings layering, the jail and cooldown gates with their clocks, all five target refusals (including the too-poor mark at exactly `max(100, minReward)`), a successful store job's payout/cooldown/streak/stats, a failed bank job's fine and sentence, a mugging moving money and writing both sides' records, the **defensive victim clamp** (unreachable in normal play — a steal is a percentage of the victim's own balance — so the test forces an oversized draw to prove nobody goes negative), the leaderboard sort, the result card in both outcomes, and the group shape.
- `test/city-panel.test.js` (17 tests): every crime present in the picker, a cooled-down job visible-but-unselectable with its wait, jail replacing the picker, jail leading with its own two buttons, the market reachable from a cell, **every offered button matched against the pump's handlers**, the argument-carrying custom ids, the bail cost and the empty-wallet refusal, the 30-second window, and the wait formatter's boundaries.
- `test/city-narrate.test.js` (14 tests): the script's shape for 0–4 events, the risk-scaled suspense and its fallback, the bail-window invariant computed from `EVENT_CHANCES` (and checked against every real event pool), placeholder substitution — including a sweep proving **no shipped event text can print a literal `{currency}`** — and the story growing one event at a time while keeping the bail offer on every beat.
- `test/city-targets.test.js` (13 tests): the four reasons a mark is refused and their precedence, the exact-minimum boundary, a message for every reason, the last-victim rule applying to the roll but not to a deliberate pick, the roll landing only on eligible members, the two-person-guild repeat fallback, and a malformed candidate refused rather than crashing the roll.
- `test/city-attempt.test.js` (17 tests): the attempt edited once per beat, **the narrated events matching the result card exactly** (with a non-repeating rng, because a deterministic one cannot tell a double draw apart), the bail offer on every pre-verdict beat, a bail at the second *and* at the last beat both stopping the crime with no money moved, a control proving the crime does settle when nobody bails, the picker opening for an unmarked targeted crime, the victim being remembered, candidate gathering and its cap, and the market/board payloads including the disabled-when-broke menu and the unknown-category fallback.
- **Manual (live server) checklist:**
  1. `!crime` → the board with four crimes, all ready, no streak.
  2. `!crime store` → a result card with at least one event line and, on a win, the reward maths.
  3. Win twice in a row → the second card shows 🔥 **Streak 2** and a ×1.10 multiplier.
  4. `!crime pickpocket @someone-broke` → refused with the minimum they need to be carrying.
  5. Get caught → `!crime bank` refuses with your release time; `!crime stats` shows the cell.
  6. `!crime bail` → the price shown in `!crime` is what you pay, and you walk.
  7. Get caught again → `!crime jailbreak` → a story, the odds after its events, and either freedom or +30%; a second attempt is refused.
  8. `!crime random` → a titled one-off job with its own flavour text.
  9. `!crime market` → `!crime buy jail_pass` → get caught → `!crime usepass` walks you out.
  10. `!crime leaderboard streak` → the board for best streaks; `!crime admin` → the four knobs.
  11. **(S124)** `!crime` → pick **Rob store** → the message narrates each event ~4 s apart, Bail Out stays under the latest line, and the result card replaces it at the end.
  12. **(S124)** Start a bank heist and press **Bail Out** after the second event → 100 🍩 gone, cooldown running, no jail, no payout.
  13. **(S124)** Pick **Pickpocket** → the mark picker appears; **🎯 Random Target** never lands on you, a bot, or the member you just robbed.
  14. **(S124)** Press **🕯️ Market** → buy a jail pass from the select → the shelf updates and the receipt is private; **◀️ Back** returns to the panel.
  15. **(S124)** Press **🏆 Board** → switch category in the select → the board re-renders on the same message.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| I cannot bail out | The precinct may have bail switched off, or you cannot afford it | `!crime` shows the price; a jailbreak is free to attempt |
| My jailbreak was refused | One attempt per sentence, spent whether it worked or not | Bail out, or wait the sentence out |
| "They are carrying less than X" | The cog refuses marks not worth robbing | Pick a richer target, or a crime that needs none |
| My streak vanished | A day without a successful crime wipes it | Consecutive wins rebuild it, +5% a step |

## Changelog

| Session | Change |
|---|---|
| S134 | **Times are Discord timestamps.** The cell's release on both `!city` and the `!crime` panel is now `<t:…:R>` — it counts down live and shows in each reader's own timezone, instead of a `45m 00s` that was stale the moment it was sent. The crime picker's `⏳ wait 24h 00m` stays **plain on purpose**: Discord prints timestamp markup literally inside select-menu options. |
| S133 | **`!city` exists again.** The owner reported City/Crime a third time; the crime panel was fine, but `!city` — removed as an alias in S122 with the name reserved "for the hub when it exists" — had been answering with **silence** for eleven sessions, because the router drops an unknown command without a word. The hub is the source's `MainMenuView`, the one view in M26.3's inventory that was never built: wallet/record/streak/cell plus 🌃 Jobs, 🕯️ Market, 🏆 Board, 📋 Record. The crime panel gains 🌆 **Streets**; the market/board **Back** now returns to whichever screen opened it (origin in the custom id) instead of always the jobs board; `!crime stats` and the Record button share one builder. The regression test resolves `!city` **through the loader**, because a file existing on disk is not the same fact as the bot having the command — and it was the second that was false. |
| S124 (M26.3b) | **The crime plays out.** Events are narrated one at a time (2 s opening, 4 s per event, 4–6 s of suspense by risk) with **the bail flag checked before every beat** — a four-event bank job now offers six chances to walk away instead of S122's one. The narrator draws the events and hands the same list to the resolver, so the story and the outcome are one crime. **The mark picker** replaces the panel's pointer back to `!crime pickpocket @member`: a user select, a 🎯 random roll that skips bots/you/cellmates/the too-poor/your last victim, and Cancel. **Market and Board are panel buttons** on both the street and jail views, each with a Back button; buying is one press. Fixed on the way: `boardPayload` crashed on an unknown category (`cityLeaderboard` returns `null`, and the raw key was passed through while only the label fell back). |
| S122 (M26.3a) | **The panel.** `!crime` opens an interactive board — a select menu of jobs with reward/risk/cooldown per row, jail's two buttons when you are inside — instead of a wall of subcommands. Adds the source's **Bail Out** mechanic, which had no home on a command-only surface: pay 100 🍩 mid-attempt to walk away, cooldown still burns. **`city` is no longer an alias of `crime`** — the owner noticed they were the same command; in the source they are two. Market, leaderboard and target-picking stay subcommands until 26.3b, and the panel shows no buttons for them. |
| S92 | **Slice D — M16.13 complete**: the black market (the permanent −20% sentence perk and the get-out-of-jail card, with an inventory on the member record), six leaderboards, and `!crime admin` (Manage Server) for bail and steal limits. The cog's third market item is deliberately not sold — see the deviation above. |
| S91 | **Slice C**: the ways out of a cell and the 46 one-off scores. `!crime bail` (the cog's exact `int(multiplier × minutes left)` — slice A's formula was rounding the minutes up first, corrected), `!crime jailbreak` (one attempt per sentence, claimed before the roll; a drawn script's events all apply; a failure adds 30% of what was left), and `!crime random` (46 scenarios overriding the `random` crime's numbers). Both scenario tables dumped from the Python with their module constants resolved. |
| S90 | **Slice B**: storage (`cityMembers`, `citySettings`), the `!crime` group (pickpocket/mug/store/bank/stats) with the cog's gate order, real money through the economy seam, the victim clamp, and a result card that prints the event lines and the reward arithmetic. Jail is a timer with no exit yet — bail lands in slice C. |
| S89 | Created (M16.13 **slice A**): the five crimes with the cog's numbers, the 96 random events dumped verbatim from the Python source, and the pure resolver — event draw (100/75/50/10, no repeats), the modifier pipeline with its clamps, streaks (+5% a step, +25% cap, 24 h expiry), the cog's step-by-step reward rounding, targeted-steal maths, fines, and the broke-crook double sentence. No commands, events or storage yet. |
