# City — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** 🚧 staged port — **slice A landed (S89): rules engine only, no commands yet**
**Last updated:** Session 89 · 2026-07-25

## Purpose

The street level of the precinct's underworld: City, ported from CalaMari-Cogs/city (owner request, S65 batch → M16.13). Members attempt crimes — picking a pocket, mugging someone, robbing a store, hitting a bank — each with its own odds, payout, cooldown, fine and jail sentence. Every attempt draws random events that swing the odds, the take and the sentence, and consecutive successes build a streak bonus.

The cog is ~7,000 lines, so it lands in slices, using the shape that worked for heist:

| Slice | Contents | Status |
|---|---|---|
| **A** | Crime table, the 96 events, the pure resolver | ✅ S89 |
| **B** | Storage + the `!crime` command surface | planned |
| **C** | Jail, bail, jailbreak + the 46 random scenarios | planned |
| **D** | Black market, leaderboards, admin surface | planned |

**This manual describes slice A**: the rules engine only. The manifest is deliberately empty, so the precinct sees nothing yet.

## Commands

**None yet** — the surface is slice B.

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| _(none in slice A)_ | — | — | — | — |

## Events

None in slice A.

## Configuration

None yet. Slice B adds per-member state (cooldowns, jail, streak, lifetime stats) and the guild settings the cog calls `global_settings` (bail multiplier, steal caps, default sentences), whose defaults are already in `lib/tables.js`.

## Permissions & safety

- Nothing is reachable by members yet.
- Two rules are already fixed for the later slices: payouts and fines go through the economy module's `adjustBalance` seam (the S8 rule), and a targeted crime must never take more than the victim actually holds — the resolver reports the intended transfer and the caller clamps it.

## How it works

- `lib/tables.js` — the five crimes with the cog's numbers (`pickpocket` 150–500 at 60% / 10 min cooldown / 1 h jail; `mugging` 400–1500 at 60%; `rob_store` 500–2000 at 50% / 6 h / 3 h; `bank_heist` 1500–5000 at 40% / 24 h / 4 h; `random`, whose numbers each scenario overrides in slice C), the `global_settings` defaults, and the streak rules. Where the cog's comment and its value disagree (`rob_store`'s fine says "45%" but is 0.4) the **value** wins, pinned in a test.
- `data/crime-events.json` — the **96 events, 24 per crime, dumped straight out of the Python source** rather than retyped. There is no transcription step to get wrong; the test validates the shape (every event has display text and at least one real effect, and only known effect keys appear).
- `lib/resolve.js` — pure. `drawEvents` (first guaranteed, then 75% / 50% / 10%, drawn without replacement), `applyEvents` (chance bonuses clamp at 100%, penalties at the cog's 5% floor; jail multiplies cumulatively with truncation at each step; direct credit effects sum separately), `nextStreak`/`streakBonus` (+5% a step, capped at +25%, wiped after 24 idle hours), `stolenAmount` (a random slice of the victim capped by the settings *and* the crime's own ceiling, floored at its minimum when the victim can cover it), and `resolveCrime`, which ties it together.
  - **The rounding order is the behavior**: on a success the cog rounds after the streak multiplier and then again after *every* event multiplier — not once at the end — so the port does the same, and reports each step for the result card slice B will draw.
  - On a failure the fine is `int(maxReward × fineMultiplier)`; a member who cannot pay it loses everything they have **and serves double** (the cog's rule).
  - A targeted crime's whole transfer — reward plus event credit effects — comes out of the victim, matching the cog; a first draft of this port split them, and the test caught it.

## Files

```
src/modules/city/
  index.js                 manifest — deliberately empty until slice B
  lib/tables.js            5 crimes, settings defaults, streak + event-draw rules
  lib/resolve.js           the pure resolver: draw → fold → roll → pay or jail
  data/crime-events.json   96 events, dumped verbatim from the source
test/city.test.js          tables, event pool, draw, modifiers, streaks, attempts
```

## Testing

- `test/city.test.js` (11 tests): the crime values (including the comment-vs-value case), the 96-event pool's integrity and key set, the draw (four distinct events when every roll lands, one when none do, the `0.75` boundary, and no rng calls at all for a crime with no pool), the modifier folds with both clamps, the streak ladder and its 24-hour expiry, all five steal branches, a scripted success proving the two-stage rounding, a failure with its fine and folded sentence, the broke-and-doubled path, a targeted success, and the cooldown/jail/bail helpers.
- **Manual (live server) checklist:** nothing to click yet — slice A ships no surface.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `!crime` does nothing | Expected: slice A has no commands | The surface lands in slice B |

## Changelog

| Session | Change |
|---|---|
| S89 | Created (M16.13 **slice A**): the five crimes with the cog's numbers, the 96 random events dumped verbatim from the Python source, and the pure resolver — event draw (100/75/50/10, no repeats), the modifier pipeline with its clamps, streaks (+5% a step, +25% cap, 24 h expiry), the cog's step-by-step reward rounding, targeted-steal maths, fines, and the broke-crook double sentence. No commands, events or storage yet. |
