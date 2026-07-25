# Heist — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable — **the staged port is complete (S85–S88)**
**Last updated:** Session 88 · 2026-07-25

## Purpose

The other side of the badge: Heist, ported from maxcogs/heist (owner request, S65 batch → M16.12) — a long-form crime economy where officers-turned-crooks run timed jobs, spend tools and shields, build police heat, land in jail, and grind materials into better gear across 120 levels.

At 4,442 lines the cog was far too large for one session, so it landed in four: **A** (S85) the rules engine, **B** (S86) storage and the `!heist` surface, **C** (S87) the self-announcing scheduler, **D** (S88) crew robbery and the tunable job table. All four are in.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!heist` (alias `!heists`) | Group: run jobs, gear up, sell, craft, bail out; bare = your profile | subs below | Everyone | `!heist bank` |

### !heist (S69-style group)

| Subcommand | Does |
|---|---|
| `!heist play <job> [confirm]` (aliases `start`, `do`) | Start a job; `!heist bank` works too (play is the fallback sub) |
| `!heist jobs` (aliases `list`, `cooldowns`) | Every job: payout, odds, and ready / cooling-down |
| `!heist shop` | Gear for sale — 6 shields and 23 tools, with prices |
| `!heist buy <item> [amount]` | Buy gear (1–100 at a time) |
| `!heist equip <item>` / `!heist unequip <shield\|tool>` | Fill or clear a slot |
| `!heist inventory` (alias `inv`) | Your gear, loot, materials and any debt |
| `!heist sell <item> [amount]` | Sell loot or materials — the price is rolled per unit |
| `!heist craft [recipe]` | Bare lists all 28 recipes (✅ = affordable); with a name, crafts it |
| `!heist bail [@member]` | Pay bail for yourself or someone else |
| `!heist paydebt` | Pay down what you owe, as far as your balance reaches |
| `!heist crew` | Organise a **4-officer crew robbery** (needs level 20) — a button lobby, 3 minutes to fill |
| `!heist admin …` | **Manage Server:** tune the job table, item prices and payout events (see below) |
| `!heist level [@member]` | Level, XP bar and the success bonus it buys |

- **Running a job:** the gates fire in the cog's order — jail, then debt, then an already-running job, then the cooldown. Item and job names accept spaces or underscores (`bank drill` = `bank_drill`).
- **The debt consent (deviation):** the cog popped a confirm button when your balance could not cover the job's worst case. The text-only version refuses once, explains that the shortfall becomes **debt + 20% tax**, and asks you to repeat the command with `confirm` — `!heist play bank confirm`.
- **Results:** when the clock runs out the bot posts the cog's result card in the channel you started from — status line, a flavour line, the money or loot, shield/tool notes, any material drop, and on an arrest the jail clock plus bail — pinging exactly you. If that announcement can't happen (channel deleted, bot restarted at the wrong moment), the job stays pending and settles the next time you run **any** `!heist` command, so a result is never lost.
- **Crew robbery** (`!heist crew`): only a level-20+ officer may organise one. The lobby holds exactly **4** and closes after 3 minutes; the organiser is in by default and cancels with ✖️ rather than leaving. Everyone is re-checked at launch — jailed, indebted or already-working officers block the start. Then **one shared success roll decides for the whole crew** (no tool boost, no level bonus — the cog's rule), the haul or the loss is drawn once and split `total ÷ 4`, each officer's own shield protects their own share, and **the police roll is per officer**, so some walk while others sit in a cell. One settlement covers all four: whoever's command or timer gets there first, everybody's result lands in the same card.

### !heist admin (Manage Server)

| Form | Does |
|---|---|
| `!heist admin show` | Every override in force, plus any running event |
| `!heist admin set <job> <field> <value>` | Override one field — `minReward`, `maxReward`, `minSuccess`, `maxSuccess`, `policeChance`, `risk`, `cooldownMs`, `durationMs`, `jailMs` (the three time fields are typed in **seconds**) |
| `!heist admin reset [job]` | Clear one job's overrides, or all of them |
| `!heist admin price <item> <cost>` | Reprice a shop item (the cog's `get_item_cost`) |
| `!heist admin event <2–5> [hours]` / `!heist admin event stop` | Multiply every payout for a window |

Overrides are sparse: only what you set is stored, so improving a default later still reaches this precinct. Values are range-checked against the cog's `_PARAM_META` bounds.

## Events

- `ClientReady` (once) — the boot catch-up: every stored job that was still running is re-armed, and every one whose clock ran out while the bot was down settles immediately.
- `InteractionCreate` — the `hst:` crew-lobby pump (join / leave / begin / cancel).

## Configuration

- `heistPlayers` in the guild store, keyed by member: `{ inventory, equipped {shield,tool}, heat, heatLastSet, materialHeat, debt, jail {endsAt,bail}, xp, stats {success,fail,caught}, cooldowns {job: startedAt}, activeHeist {type,endsAt,channelId,taxAgreed,crew?,leader?} }`.
- `heistSettings`: `{ jobs: {job: {field: value}}, prices: {item: cost}, event: {multiplier, endsAt} }` — all sparse, all set through `!heist admin`.

## Permissions & safety

- **Member permissions:** the game is public, like the cog; only `!heist admin` is gated (Manage Server — the cog made it bot-owner-only, but a precinct admin is the right level here).
- **Economy:** every payment goes through the economy module's `adjustBalance` seam with a lazy import and a try/catch (the S8 rule) — a disabled economy degrades the game instead of breaking it.
- **Pings:** one scoped ping when your job lands (the whole crew on a crew job); everything else renders mentions without notifying.
- **Storage:** per member, per guild. **A restart mid-job costs nothing:** timers live in RAM, but `activeHeist` (type, `endsAt`, `channelId`) is on disk, so boot re-arms the pending ones and settles the overdue ones. If even that fails, the lazy path still reports on the player's next command.

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
- `lib/flavour.js` — the cog's narration lines, verbatim (crew lines carried for slice D), plus its heat bar.
- `service.js` (slice B) — the store layer and the gates: `getPlayer` (normalized, heat already decayed), `startHeist`, `settleActiveHeist` (runs the pure resolver, applies `nextState`, pays `balanceDelta`, clears the job), `buyItem`/`sellItem`/`equipItem`/`craftItem`, `payDebt`, `payBail`, plus `jailStatus`/`cooldownLeft`/`readyJobs`. **Deviation:** heat decay is computed at read time from `(heat, heatLastSet)` rather than written back on every read — same schedule (one point per two idle hours), but it spares the Pi's SD card and stops the decay depending on how often you look.
- `commands/heist.js` — the group. Each of the cog's select-menu views became a named subcommand, and every command settles a finished job before doing anything else.
- `lib/resolve.js → resolveCrewHeist` (slice D) — the crew's own pure resolver. Two differences from the solo path are load-bearing and preserved: the shared roll uses the raw drawn percentage (no tool or level bonus), and per officer the **police roll comes before the material drop** (a solo job does it the other way round), with crew drops always 1–2.
- `events/buttons.js` — the crew lobby pump; the leader's record carries `crew` and `leader`, which is how four officers produce exactly one settlement.
- `scheduler.js` (slice C) — `armHeistTimer` (unref'd, replaces any existing timer for that player so a job can never announce twice), `fireHeist` (settle → post → ping the owner), `rearmAllHeists` (the boot walk over stored players), `cancelHeistTimer`. **A missing channel means the job is deliberately NOT settled** — leaving the record intact is what keeps the outcome recoverable instead of vanishing into a dead channel.

**Deviations recorded so far:** our economy has no maximum balance, so the cog's "balance already at maximum" branch is dropped. Everything else in slice A is faithful, *including float artifacts*: `trunc(1000 × (1 − 0.07))` is **929**, not 930, in both Python and here — the port preserves the expression, not the intent (see `.claude/skills/run-skill-generator/references/architecture.md`).

## Files

```
src/modules/heist/
  index.js               manifest
  lib/tables.js          74 items · 28 recipes · 24 jobs (verbatim)
  lib/leveling.js        XP curve, level bonus, XP awards
  lib/resolve.js         the pure resolver + heat decay + bail
  lib/crafting.js        craft plan, craftable list, sell ranges
  lib/flavour.js         the cog's narration lines + heat bar
  service.js             storage, gates, settlement, economy seam
  scheduler.js           job timers, announcement, boot re-arm
  commands/heist.js      the !heist group, result cards, crew lobby, admin
  events/ready.js        boot catch-up hook
  events/buttons.js      hst: crew lobby pump
test/heist.test.js         fixture diff, table invariants, XP curve, resolver, crafting
test/heist-service.test.js storage, gates, settlement, shop/sell/craft/bail, group shape
test/heist-scheduler.test.js firing, arming, cancelling, boot catch-up
test/heist-crew.test.js    crew resolver, lobby, one-settlement rule, admin tuning
test/fixtures/heist-source-tables.json   the cog's tables, dumped from Python
```

## Testing

- `test/heist.test.js` (19 tests). The load-bearing one is the **fixture diff**: `test/fixtures/heist-source-tables.json` was produced by *executing* the cog's `utils.py` and dumping its three tables, so the test proves the JS transcription still matches the original entry for entry — long after the Python source (a scratchpad clone) is gone. The rest: table invariants (every tool points at a real job, every recipe needs real materials, crafted gear has no shop price, exactly three jobs pay in goods), the XP curve and its cap, and the resolver driven by a **scripted rng** that throws when a queue runs dry — so a passing test also proves the resolver made exactly the calls the cog makes, in the cog's order. Branches covered: clean success with an event multiplier, loot-paying job, tool consumed/boosted/unequipped, wrong-job tool ignored, shielded failure, full shield absorbing everything, unpayable loss becoming taxed debt, caught-on-success (seizure, jail, bail + 15%, heat wiped, no XP), caught-on-failure confiscation, caught-on-loot-success confiscation, the material pity counter, the police heat cap, heat decay, and crafting.
- `test/heist-service.test.js` (16 tests): the player shape, read-time heat decay, jail status and its 15% bail tax, cooldowns and the ready list, starting a job, lazy settlement (nothing while running, exactly once when done, donuts actually moved, cooldown preserved), an arrest writing jail state, an unpayable loss becoming taxed debt with `paydebt` clearing it in two goes, the shop's 29 priced items and a real purchase, equip validation, per-unit sell rolls, crafting, bail (too poor → still inside; paid → free with heat wiped), the result card, and the group shape.
- `test/heist-scheduler.test.js` (10 tests): firing a due job (settled, announced, owner pinged, job cleared), the vanished-channel case leaving the record for the lazy path, a failing send still settling, arming a timer that fires unprompted, re-arming replacing the old timer so nothing announces twice, cancelling, and the boot catch-up (one job re-armed, one overdue job settled, an idle player untouched). The waiting tests use the `setInterval` keep-alive the unref'd-timer rule requires.
- **Manual (live server) checklist:**
  1. `!heist` → your profile (level 1, empty heat bar, 23/23 jobs ready).
  2. `!heist jobs` → the board; `!heist vending_machine` → "in progress", landing in 30 s.
  3. Wait 30 seconds without typing anything → **the result card appears on its own** and pings you.
  4. Start a longer job, then have the owner restart the bot before it lands → it still announces (boot re-arm).
  4. `!heist shop` → `!heist buy crowbar` → `!heist equip crowbar` → `!heist atm_smash` → the start card names the tool bonus.
  5. Run jobs until materials drop, then `!heist craft` → craft whatever shows ✅.
  6. Get arrested → any `!heist play` refuses with the jail line → `!heist bail` frees you.
  7. At level 20+: `!heist crew` → three colleagues press **Join Crew** → **Begin Heist** → one card lands for all four, and some of you may be in a cell while others are not.
  8. `!heist admin set vending_machine durationMs 5` then `!heist vending_machine` → it lands in five seconds; `!heist admin reset` puts it back.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| My job finished but nothing was posted | The announcement could not be delivered (channel gone, or the bot was down and the boot re-arm missed it) | Run any `!heist` command — the result is still pending and will report |
| The result came twice | Should be impossible: re-arming replaces the timer and the lazy path cancels it | If you ever see it, that is a bug worth logging |
| `!heist play` refuses with a debt warning | Your balance cannot cover the job's worst case | Pick a smaller job, or repeat with `confirm` and accept debt + 20% tax |
| Crew robbery is refused | It needs a four-officer lobby (slice D) | Any solo job works |
| A table number looks wrong | The fixture diff would have failed | Run `npm test`; if it passes, the value matches the cog by definition |

## Changelog

| Session | Change |
|---|---|
| S88 | **Slice D — M16.12 complete**: crew robbery (level-20 organiser, 4-seat button lobby with a 3-minute clock, one shared success roll, haul split four ways, per-officer shields and police rolls, a single settlement driven by the leader's record) and the admin surface — `!heist admin show/set/reset/price/event` with the cog's range guards, sparse overrides layered over the ported defaults, item repricing, and payout events that finally make the resolver's `eventMultiplier` live. |
| S87 | **Slice C**: the job scheduler — `armHeistTimer`/`fireHeist`/`cancelHeistTimer` plus a `ClientReady` boot catch-up that re-arms running jobs and settles the ones that finished while the bot was down. Results now announce themselves in the channel the job started from, pinging exactly the officer. A missing channel deliberately leaves the job unsettled so the lazy path can still report it; the lazy path cancels the armed timer so nothing reports twice. |
| S86 | **Slice B**: storage (`heistPlayers`), the `!heist` group (play/jobs/shop/buy/equip/unequip/inventory/sell/craft/bail/paydebt/level — each of the cog's select views became a subcommand), the cog's gate order, the result card with its flavour lines, and the economy seam. A finished job settles lazily on the player's next command (the cog's own fallback). Deviations: a text `confirm` token replaces the debt-consent button; heat decays at read time instead of being rewritten on every read. |
| S85 | Created (M16.12 **slice A**): the cog's 74 items / 28 recipes / 24 jobs transcribed verbatim and machine-diffed against the Python source (fixture committed so the check is permanent), the 120-level XP curve, the pure `resolveHeist` (tools, shields, debt + tax, heat, material pity counter, police roll, jail + bail, confiscation, XP) and crafting. No commands, events or storage yet — the manifest is empty on purpose. Corrections to the S65 survey: the cog has **24** jobs and **74** items, not 25 and ~75. |
