# Heist — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** 🚧 staged port — **slice A landed (S85): rules engine only, no commands yet**
**Last updated:** Session 85 · 2026-07-25

## Purpose

The other side of the badge: Heist, ported from maxcogs/heist (owner request, S65 batch → M16.12) — a long-form crime economy where officers-turned-crooks run timed jobs, spend tools and shields, build police heat, land in jail, and grind materials into better gear across 120 levels.

At 4,442 lines the cog is far too large for one session, so it lands in slices (the plan is in `ROADMAP.md`). **This manual describes slice A**, which is the whole rules engine and nothing else: no commands, no buttons, no storage, no timers. The module's manifest is deliberately empty, so the precinct sees nothing yet.

## Commands

**None yet** — the command surface (`!heist`, the shop, the inventory, jail and bail) is slice B. The manifest exports zero commands and zero events on purpose, so a half-wired game can never reach the live server via the self-update timer.

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| _(none in slice A)_ | — | — | — | — |

## Events

None in slice A.

## Configuration

None in slice A (nothing is persisted yet). Slice B adds per-member state — inventory, equipped gear, heat, debt, jail, XP, stats — and the admin-tunable copies of the job table.

## Permissions & safety

- Nothing is reachable by members yet, so there is nothing to gate.
- Two safety rules are already fixed by the slicing plan: the economy tie-in will go through the existing `adjustBalance` seam (the S8 rule — a broken economy degrades, never blocks), and slice C's timers must **survive a restart** (persist `endsAt`, re-arm on boot) rather than living only in RAM.

## How it works

- `lib/tables.js` — the cog's three data tables, transcribed **verbatim**: 74 items (shields, tools, loot, materials, and their crafted "enhanced"/"reinforced" versions), 28 craft recipes, and 24 jobs from `vending_machine` (10–80 donuts, 30 s) to `gold_reserve` (3–4 million) and `crew_robbery`. Python `timedelta`s became milliseconds and keys became camelCase; nothing else changed.
- `lib/leveling.js` — the WoW-style curve: step *n* costs `floor(100·n·(1 + 0.12·n))`, cumulative through level 120, plus the success bonus it feeds the resolver (+0.5% per level, capped at +20% from level 40). The cog's own comment claims level 2 costs 212 XP; its formula says 112 — the formula wins, and a test pins it.
- `lib/resolve.js` — `resolveHeist(input, rng)`: **pure**. It takes a snapshot (inventory, equipped gear, heat, debt, XP, balance, the job's settings, `now`) plus an rng, and returns the outcome *and* the next state. No store writes, no Discord, no clock of its own — slice B applies `nextState` and pays `balanceDelta` through the economy seam. The cog's order of operations is preserved exactly, because the **RNG call order is part of the behavior**: success roll → reward/loss roll → material drop → police roll → bail draw.
  - Success = `min((drawn% + trunc(toolBoost·100))/100 + levelBonus, 1.0)`; the equipped tool is spent whether you win or lose.
  - Failure draws a loss, an equipped shield reduces it (and is spent), and what you cannot pay becomes **debt** — plus a 20% tax if you agreed to it.
  - Heat rises by one per job *before* the police roll (police chance `+2%` per heat, hard cap 90%), an arrest resets it to zero, and idle heat decays one point per two hours (`decayedHeat`).
  - Material drops use a pity counter: `+4%` per job without a drop, cap 90%, reset on a drop; the three end-game jobs restrict the pool to their own tiers.
  - Getting caught means jail until `now + jailMs` and bail of `trunc(maxLoss · uniform(0.5, 1.0))` **+ 15% tax** — and the police take back what you just stole (the loot item, or the currency reward), or a random loot item from your collection if the job already failed.
- `lib/crafting.js` — `craftPlan` (spend exact materials, report exactly what is short), `craftableFrom`, `sellRange`.

**Deviations recorded so far:** our economy has no maximum balance, so the cog's "balance already at maximum" branch is dropped. Everything else in slice A is faithful, *including float artifacts*: `trunc(1000 × (1 − 0.07))` is **929**, not 930, in both Python and here — the port preserves the expression, not the intent (see `.claude/skills/run-skill-generator/references/architecture.md`).

## Files

```
src/modules/heist/
  index.js            manifest — deliberately empty until slice B
  lib/tables.js       74 items · 28 recipes · 24 jobs (verbatim)
  lib/leveling.js     XP curve, level bonus, XP awards
  lib/resolve.js      the pure resolver + heat decay + bail
  lib/crafting.js     craft plan, craftable list, sell ranges
test/heist.test.js    fixture diff, table invariants, XP curve, resolver, crafting
test/fixtures/heist-source-tables.json   the cog's tables, dumped from Python
```

## Testing

- `test/heist.test.js` (19 tests). The load-bearing one is the **fixture diff**: `test/fixtures/heist-source-tables.json` was produced by *executing* the cog's `utils.py` and dumping its three tables, so the test proves the JS transcription still matches the original entry for entry — long after the Python source (a scratchpad clone) is gone. The rest: table invariants (every tool points at a real job, every recipe needs real materials, crafted gear has no shop price, exactly three jobs pay in goods), the XP curve and its cap, and the resolver driven by a **scripted rng** that throws when a queue runs dry — so a passing test also proves the resolver made exactly the calls the cog makes, in the cog's order. Branches covered: clean success with an event multiplier, loot-paying job, tool consumed/boosted/unequipped, wrong-job tool ignored, shielded failure, full shield absorbing everything, unpayable loss becoming taxed debt, caught-on-success (seizure, jail, bail + 15%, heat wiped, no XP), caught-on-failure confiscation, caught-on-loot-success confiscation, the material pity counter, the police heat cap, heat decay, and crafting.
- **Manual (live server) checklist:** nothing to click yet — slice A ships no surface. The first live checklist arrives with slice B.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `!heist` does nothing | Expected: slice A has no commands | The command surface lands in slice B |
| A table number looks wrong | The fixture diff would have failed | Run `npm test`; if it passes, the value matches the cog by definition |

## Changelog

| Session | Change |
|---|---|
| S85 | Created (M16.12 **slice A**): the cog's 74 items / 28 recipes / 24 jobs transcribed verbatim and machine-diffed against the Python source (fixture committed so the check is permanent), the 120-level XP curve, the pure `resolveHeist` (tools, shields, debt + tax, heat, material pity counter, police roll, jail + bail, confiscation, XP) and crafting. No commands, events or storage yet — the manifest is empty on purpose. Corrections to the S65 survey: the cog has **24** jobs and **74** items, not 25 and ~75. |
