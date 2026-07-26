# City — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable — **the staged port is complete (S89–S92)**
**Last updated:** Session 92 · 2026-07-25

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

> **Recorded deviation.** The cog re-checks the bail flag *between each narrated event*, giving a longer window. Our resolver settles a crime in one call, so the window is the 2-second beat the cog also has. Same decision, same price, fewer moments to take it. Splitting the resolver into narrated steps is 26.3b.

**Still subcommands, not buttons yet:** the black market, the leaderboard, and picking a target for `pickpocket`/`mug`. The panel deliberately shows **no button for those** — a dead button is worse than a missing one.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!crime` (alias `!city`) | Group: four crimes plus your record; bare = the board, your streak and your status | subs below | Everyone | `!crime bank` |

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

None — the crime resolves the moment you run the command.

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
  commands/crime.js        the !crime group and its result card
  data/crime-events.json   96 events, dumped verbatim from the source
  data/scenarios.json      46 one-off crimes, dumped (constants resolved)
  data/prison-breaks.json  14 escape scripts with their own events, dumped
test/city.test.js          tables, event pool, draw, modifiers, streaks, attempts
test/city-service.test.js  record, gates, payouts, victim clamp, card, group shape
```

## Testing

- `test/city.test.js` (11 tests): the crime values (including the comment-vs-value case), the 96-event pool's integrity and key set, the draw (four distinct events when every roll lands, one when none do, the `0.75` boundary, and no rng calls at all for a crime with no pool), the modifier folds with both clamps, the streak ladder and its 24-hour expiry, all five steal branches, a scripted success proving the two-stage rounding, a failure with its fine and folded sentence, the broke-and-doubled path, a targeted success, and the cooldown/jail/bail helpers.
- `test/city-service.test.js` (11 tests): the record's shape and round-trip, settings layering, the jail and cooldown gates with their clocks, all five target refusals (including the too-poor mark at exactly `max(100, minReward)`), a successful store job's payout/cooldown/streak/stats, a failed bank job's fine and sentence, a mugging moving money and writing both sides' records, the **defensive victim clamp** (unreachable in normal play — a steal is a percentage of the victim's own balance — so the test forces an oversized draw to prove nobody goes negative), the leaderboard sort, the result card in both outcomes, and the group shape.
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
| S122 (M26.3a) | **The panel.** `!crime` opens an interactive board — a select menu of jobs with reward/risk/cooldown per row, jail's two buttons when you are inside — instead of a wall of subcommands. Adds the source's **Bail Out** mechanic, which had no home on a command-only surface: pay 100 🍩 mid-attempt to walk away, cooldown still burns. **`city` is no longer an alias of `crime`** — the owner noticed they were the same command; in the source they are two. Market, leaderboard and target-picking stay subcommands until 26.3b, and the panel shows no buttons for them. |
| S92 | **Slice D — M16.13 complete**: the black market (the permanent −20% sentence perk and the get-out-of-jail card, with an inventory on the member record), six leaderboards, and `!crime admin` (Manage Server) for bail and steal limits. The cog's third market item is deliberately not sold — see the deviation above. |
| S91 | **Slice C**: the ways out of a cell and the 46 one-off scores. `!crime bail` (the cog's exact `int(multiplier × minutes left)` — slice A's formula was rounding the minutes up first, corrected), `!crime jailbreak` (one attempt per sentence, claimed before the roll; a drawn script's events all apply; a failure adds 30% of what was left), and `!crime random` (46 scenarios overriding the `random` crime's numbers). Both scenario tables dumped from the Python with their module constants resolved. |
| S90 | **Slice B**: storage (`cityMembers`, `citySettings`), the `!crime` group (pickpocket/mug/store/bank/stats) with the cog's gate order, real money through the economy seam, the victim clamp, and a result card that prints the event lines and the reward arithmetic. Jail is a timer with no exit yet — bail lands in slice C. |
| S89 | Created (M16.13 **slice A**): the five crimes with the cog's numbers, the 96 random events dumped verbatim from the Python source, and the pure resolver — event draw (100/75/50/10, no repeats), the modifier pipeline with its clamps, streaks (+5% a step, +25% cap, 24 h expiry), the cog's step-by-step reward rounding, targeted-steal maths, fines, and the broke-crook double sentence. No commands, events or storage yet. |
