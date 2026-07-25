# City — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** 🚧 staged port — **slices A+B landed (S90): playable, jail is a timer with no way out yet**
**Last updated:** Session 90 · 2026-07-25

## Purpose

The street level of the precinct's underworld: City, ported from CalaMari-Cogs/city (owner request, S65 batch → M16.13). Members attempt crimes — picking a pocket, mugging someone, robbing a store, hitting a bank — each with its own odds, payout, cooldown, fine and jail sentence. Every attempt draws random events that swing the odds, the take and the sentence, and consecutive successes build a streak bonus.

The cog is ~7,000 lines, so it lands in slices, using the shape that worked for heist:

| Slice | Contents | Status |
|---|---|---|
| **A** | Crime table, the 96 events, the pure resolver | ✅ S89 |
| **B** | Storage + the `!crime` command surface | ✅ S90 |
| **C** | Jail, bail, jailbreak + the 46 random scenarios | planned |
| **D** | Black market, leaderboards, admin surface | planned |

**Slices A and B are in**, so the game is playable: four crimes, events, streaks, fines and sentences. What is missing is the way *out* of a cell — bail and jailbreak arrive in slice C, so for now a sentence simply runs its clock.

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
| `!crime stats [@member]` (alias `record`) | The criminal record: jobs, success rate, earnings, fines, what you took and lost, streaks |

- **The gates fire in the cog's order:** jailed → cooling down → target checks. A targeted crime refuses a bot, yourself, and anyone carrying less than `max(minStealBalance, the crime's minReward)` — the cog will not let you rob someone who has nothing worth taking.
- **Every attempt draws events** (one guaranteed, then 75% / 50% / 10%) that shift the odds, multiply the take, stretch or shorten the sentence, or hand you loose change. They are all printed on the result card, and a win shows the arithmetic step by step.
- **Money is real:** payouts, fines and steals all move donuts through the economy. A steal is capped at what the victim actually holds, and both sides' records are updated.

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
  service.js               the criminal record, the gates, the money movement
  commands/crime.js        the !crime group and its result card
  data/crime-events.json   96 events, dumped verbatim from the source
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

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| I am in a cell and cannot get out | Expected in slice B — bail and jailbreak are slice C | The sentence runs its clock; `!crime` shows the release time |
| "They are carrying less than X" | The cog refuses marks not worth robbing | Pick a richer target, or a crime that needs none |
| My streak vanished | A day without a successful crime wipes it | Consecutive wins rebuild it, +5% a step |

## Changelog

| Session | Change |
|---|---|
| S90 | **Slice B**: storage (`cityMembers`, `citySettings`), the `!crime` group (pickpocket/mug/store/bank/stats) with the cog's gate order, real money through the economy seam, the victim clamp, and a result card that prints the event lines and the reward arithmetic. Jail is a timer with no exit yet — bail lands in slice C. |
| S89 | Created (M16.13 **slice A**): the five crimes with the cog's numbers, the 96 random events dumped verbatim from the Python source, and the pure resolver — event draw (100/75/50/10, no repeats), the modifier pipeline with its clamps, streaks (+5% a step, +25% cap, 24 h expiry), the cog's step-by-step reward rounding, targeted-steal maths, fines, and the broke-crook double sentence. No commands, events or storage yet. |
