# Game interaction audit — how each game is played, ours vs. its source

**Session 115 · 2026-07-26 · M26.1**

Owner, after playing what S66–S92 shipped:

> *"City crime: Dit is niet hoe het spel werkt in de link die ik je stuurde, dat werkt met panelen niet enkel met commands. Controleer alle spellen en hoe ze werken."*

He is right, and the question this audit answers is **how far the problem spreads**. The suspicion worth testing was that S68's text-only mandate had been read as *component-free*, and that every game ported after it quietly lost its panels. That turns out to be **false in general and true in two specific places**.

## Method

For each game, count the source cog's Discord-UI references (`discord.ui.View` / `Button` / `Select` / `Modal` and the `@discord.ui.button` decorator) and compare against how many of our module's files build components. Crude, but it is an *objective* signal that does not depend on my reading of either codebase, and it is decisive at the extremes — 48 versus 0 is not a judgement call.

Where the counts are close on both sides, the port kept the interaction model and only the details need checking. Where the source is high and ours is zero, the game was rebuilt as something else.

## The table

| Game | Source UI refs | Our component files | Verdict |
|---|---:|---:|---|
| **city** (crime) | **48** | **0** | ❌ **Diverged by accident** — the reported case |
| **heist** | **31** | **1** | ❌ **Diverged by accident** — 1 of ~8 panels survived |
| mafia | 100 | 2 | ⚠️ Proportional — we built 13 of 57 roles; re-check after M24.3 |
| rollout | 17 | 1 | ✅ Interaction model kept |
| russianroulette | 15 | 1 | ✅ Interaction model kept |
| connect4 | 9 | 1 | ✅ Kept — but **being replaced anyway** (M26.2) |
| memory | 9 | 1 | ✅ Interaction model kept |
| splitorsteal | 8 | 1 | ✅ Interaction model kept |
| wordle | 6 | 1 | ✅ Interaction model kept |
| guessthecandy | 4 | 1 | ✅ Interaction model kept |
| hammertime | 1 | 1 | ✅ Interaction model kept |
| **hangman** | **0** | **0** | ✅ **Faithful** — the source is message-driven too |
| **hunting** | **0** | **0** | ✅ **Faithful** — the source is a type-the-word chat game |

## The two real findings

### 1. `city` — a panel game rebuilt as a command list

The source's `crime/views.py` is **2,000+ lines**. It contains:

| View | What it is |
|---|---|
| `MainMenuView` | The hub the whole game is played from |
| `CrimeListView` / `CrimeView` / `CrimeButton` | Pick a crime and commit it from the panel |
| `CrimeAttemptView` | **Live during an attempt**, with a `Bail Out!` button |
| `BailView` | Pay bail |
| `JailOptionsView` | `Jail Break` / `Pay Bail` while jailed |
| `TargetSelectionView` | `Random Target` / `Select Target` / `Cancel` |
| `BlackmarketView` | Browse and buy |

Ours is `!crime pickpocket`, `!crime mug`, `!crime bank`, `!crime stats`… — **zero components anywhere in the module**, the only game module with neither a component nor an event file.

**`CrimeAttemptView` is the part that matters most.** A `Bail Out!` button that exists *while the crime is resolving* is not menu decoration — it is a decision the player makes mid-attempt, and it has no equivalent in a command-only surface. Everything else could be argued as a navigation preference; this one is missing gameplay.

**The engine is not the problem.** The crime tables, the resolver, streaks, the jail suite, the 46 scenarios, the black market and the leaderboards were all machine-diffed against the source in S89–S92 and are correct. This is a presentation-layer rebuild, not a re-port.

### 2. `heist` — one panel out of eight

The source has `HeistSelectionView`, `ShopView`, `EquipView`, `CraftView`, `CrewLobbyView`, `HeistConfigView`, `ItemPriceConfigView` and `EventView`. We built **`CrewLobbyView` and nothing else** — `!heist play <name>`, `!heist shop`, `!heist buy`, `!heist equip`, `!heist craft`, `!heist admin` are all commands where the source is a panel.

Not reported by the owner, and less severe than city — the crew lobby, the one genuinely multiplayer moment, is the one we got right. But it is the same mistake at smaller scale, and it is worth fixing in the same pass while the pattern is fresh.

## What was NOT wrong

**S68 did not cause this.** Text-only was never component-free, and the audit shows the majority of games kept their panels: trivia, connect4, the patrol wizard and the help panel all use buttons today. Nine of thirteen games match their source's interaction model. Two games diverged, and both are the two **largest** ports — heist (4 sessions) and city (4 sessions). That is the actual pattern, and it is a more useful one:

> **A staged port loses the interaction model at the seams.** Both games were sliced as *engine → storage → commands → extras*. The command surface was built in slice B as scaffolding to make the engine reachable, and by slice D it had become the product — because every later slice added features *to the commands that existed*, never questioning whether commands were the right surface. The panel was never dropped; it was never scheduled.

The fix for next time is a slicing rule, not a vigilance rule: **when a staged port's source is panel-driven, the panel belongs in the first slice that a player can touch** — not after the features, because after the features it is a rewrite instead of a starting point.

## Scheduling

| Slice | Work | Estimate |
|---|---|---|
| **M26.2** | Connect4 → the `minigames` cog (see below) | 2 sessions |
| **M26.3** | City → panel-driven, keeping the S89–S92 engine | 2 sessions |
| **M26.4** | Heist → the remaining seven panels | 1–2 sessions |
| — | mafia re-check | folded into M24.3, if that is ever scheduled |

## M26.2 note: the replacement is wider than Connect 4

`Brandjuh/FireAndRescueAcademyCogs/minigames` (1,233 lines) is **two** games plus a shared frame:

- **Connect 4** (416 lines) and **Tic-Tac-Toe** (210 lines) — we have the first, not the second.
- **Economy staking**: `bet_amount` default 100, winner takes a random `win_min`–`win_max` (default 400–600). Bets are withdrawn up front, refunded if the game is cancelled before it starts. We have no staking in connect4 at all.
- **Per-member stats**: games / wins / losses / ties / earnings / last game, with `!gamestats` and a sortable `!gameleaderboard`.
- **One game per channel**, works in threads, and an inactive game (past `TIME_LIMIT`) may be replaced by anyone.
- Invite / rematch / replace views — an opponent **accepts** before play begins.

Two decisions the owner should make explicitly rather than have inferred:

1. **Does the S100 solo AI survive?** The cog has its own bot opponent (a scoring heuristic: win → block → count 3-in-a-rows → centre preference, with 5% randomness). Ours is a negamax with alpha-beta and three difficulty levels, which is strictly stronger. "Replace" taken literally means dropping ours for theirs.
2. **Does Tic-Tac-Toe come along?** It is in the cog the owner pointed at, so the plain reading is yes — but it is a second game, not part of Connect 4.

Both are recorded here rather than guessed at. Neither blocks starting M26.2; both change what "done" means.

## Sources

Cloned fresh for this audit (all public, all clone through the git proxy):

`Brandjuh/FireAndRescueAcademyCogs` · `CalaMariGold/CalaMari-Cogs` · `ltzmax/maxcogs` · `AAA3A-AAA3A/AAA3A-cogs` · `phenom4n4n/phen-cogs` · `Flame442/FlameCogs` · `Chovin/Dumb-Cogs` · `vertyco/vrt-cogs`

Session workspaces are ephemeral — re-clone rather than expecting these to persist.
