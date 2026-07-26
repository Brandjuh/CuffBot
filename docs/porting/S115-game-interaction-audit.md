# Game interaction audit — how each game is played, ours vs. its source

**Session 115 · 2026-07-26 · M26.1**

Owner, after playing what S66–S92 shipped:

> *"City crime: Dit is niet hoe het spel werkt in de link die ik je stuurde, dat werkt met panelen niet enkel met commands. Controleer alle spellen en hoe ze werken."*

He is right, and the question this audit answers is **how far the problem spreads**. The suspicion worth testing was that S68's text-only mandate had been read as *component-free*, and that every game ported after it quietly lost its panels. That turns out to be **false in general and true in two specific places**.

## Method

For each game, count the source cog's Discord-UI references (`discord.ui.View` / `Button` / `Select` / `Modal` and the `@discord.ui.button` decorator) and compare against how many of our module's files build components. Crude, but it is an *objective* signal that does not depend on my reading of either codebase, and it is decisive at the extremes — 48 versus 0 is not a judgement call.

> **Correction (S117).** This method measures **how a game is driven**, not **whether it works**. The table below originally called hangman *faithful*; the evidence only supported *same interaction model*. The owner then found that `!hangman` answered with a menu where FlameCogs' plain `[p]hangman` starts a game — true of six other ports as well, and invisible to a component count because none of them involve components. A verdict that claims more than the measurement closes a question that is still open.

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
| **hangman** | **0** | **0** | ⚠️ **Same interaction model** — but S117 found `!hangman` answered with a menu where the source's plain command starts a game. See the correction below. |
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

---

## Closed — Session 132

The S117 correction above said this audit's method *"measures how a game is driven, not whether it works"*, and that a verdict claiming more than the measurement **closes a question that is still open**. The question is now closed, on evidence rather than on the component count.

**What M26 fixed** (the two the count did identify, plus one the owner reported): city → S122/S124, heist → S126/S130, connect4 → replaced by `minigames` in S116/S125. The seventh defect S117 found — a bare `!game` printing a menu where the source's plain command starts a game — was fixed across **seven** modules and is now held by a loader test (`PLAYS_ON_THE_BARE_WORD`).

**What S132 checked on the remaining ten**, each an objectively verifiable class rather than a reading:

| Class checked | Method | Result |
|---|---|---|
| Numeric parameters | Every timeout, window, difficulty, attempt count and prize range diffed against the Python | **All match.** wordle 5/6 and 300 s, guessthecandy 5 and 180 s, russianroulette 5 s, rollout 30 s, splitorsteal 60 s, memory 5×5 |
| Stats persistence | Which sources declare `register_guild(wins=, games=)`, and whether ours persist the same | **All match.** rollout, wordle and memory keep stats; russianroulette, splitorsteal and guessthecandy have none upstream and none here |
| Leaderboards | Which sources expose one | **All match** — present exactly where upstream has one |
| Bare-word invocation | The S117 class | Fixed in seven modules, **guarded by a test** |
| Test coverage | Every loaded module referenced by at least one test file | **37/37** |

**No divergence found.** Two things are worth saying about that rather than leaving it implied:

1. **The ports were done carefully.** Several carry recorded deviations that only a real diff would produce — rollout's comment that *the cog's help text says 5000 while its code says 2500*, memory's note that the source's `lose()` increments `games` a second time when it was already counted at start, city's *"the cog's comment says 45%, its value says 40% — the value wins"*. Those are the fingerprints of someone having actually read the source, and they are why this sweep found nothing.
2. **A clean sweep is a finding, not a non-event.** It is what lets the next session stop re-opening *"controleer alle spellen"* and spend the time on something the owner has actually asked for.

**What is deliberately still open:** `mafia` remains ⚠️ *proportional* — 13 of 57 roles. That is scope, not divergence, and its gate is M24.3's owner decision, not a session.
