# Minigames 🔴

Panel-driven minigames, ported from the `minigames` cog in [`Brandjuh/FireAndRescueAcademyCogs`](https://github.com/Brandjuh/FireAndRescueAcademyCogs/tree/main/minigames) (M26.2, owner request: *"Connect4: Vervang deze met …"*).

**This module replaces the S71/S100 `connect4` module outright.** Scores carry over — the storage key is unchanged.

## At a glance

| | |
|---|---|
| **Commands** | `!connect4` (`!c4`), `!tictactoe` (`!ttt`), `!minigames` (`!mgset`), `!gameleaderboard` (`!glb`, `!gtop`) |
| **Category** | games |
| **Permissions** | public, except the four config subcommands (Manage Server) |
| **Storage** | `connect4Stats` and `minigamesConfig` (per guild) |
| **Source** | `Brandjuh/FireAndRescueAcademyCogs/minigames` (M26.2a: Connect 4 + the panel; M26.2b: Tic-Tac-Toe, staking, the sortable board, config) |

## Commands

| Command | What it does | Args | Who | Example |
|---|---|---|---|---|
| `!connect4` | Open a Connect 4 panel against the bot | none | Everyone | `!connect4` |
| `!connect4 @officer` | Challenge someone — they must accept | `<member>` | Everyone | `!connect4 @Vance` |
| `!connect4 end` | End the game in this channel | none | Everyone\* | `!connect4 end` |
| `!tictactoe` | The same, for Tic-Tac-Toe | `[member]` | Everyone | `!ttt @Vance` |
| `!tictactoe end` | End the game in this channel | none | Everyone\* | `!ttt end` |
| `!minigames` | Bare: the buy-in, the prize range, how to play | none | Everyone | `!minigames` |
| `!minigames stats` | Your record, or someone else's | `[member]` | Everyone | `!minigames stats @Vance` |
| `!minigames bet` | The buy-in per player; `0` turns staking off | `<amount>` | Manage Server | `!minigames bet 250` |
| `!minigames winmin` / `winmax` | The prize range | `<amount>` | Manage Server | `!minigames winmax 900` |
| `!minigames betvsbot` | Whether bot games are played for donuts | `<true\|false>` | Manage Server | `!minigames betvsbot false` |
| `!gameleaderboard` | The precinct board, sorted your way | `[wins\|earnings\|games\|winrate]` | Everyone | `!glb winrate` |

\* A game that is still being played may only be ended by its two players. A **stale** one (see below) may be ended by anyone.

> **`!connect4 stats` and `!connect4 board` are gone (S125).** Both games write to one set of counters — the cog pools them too — so a Connect-4-branded board showing Tic-Tac-Toe results would be a lie. They became `!minigames stats` and `!gameleaderboard`. They were **not** kept as aliases: the owner's complaint about `!city`/`!crime` was precisely two names for one thing.

## The panel is the game

This is the whole reason M26 exists. The source cog is **one message that IS the game** — the bot edits it in place on every move — and the module this replaces had shipped a command per action instead (see `docs/porting/S115-game-interaction-audit.md`).

1. `!connect4 @officer` posts the panel with **Accept** / **Decline**. Only the challenged officer can answer.
2. On accept, the panel becomes the board plus **seven column buttons**.
3. Each press drops a piece and re-renders the same message. The panel names whose turn it is; ▶ marks the player to move.
4. Four in a row ends it — the winning four are **brightened** (🟥/🟦) and 👑 marks the winner. The column buttons are replaced by a single **Rematch**.
5. A rematch **swaps the colours**, so whoever played blue opens the next game.

**A full column's button is disabled, not merely refused.** The source cog *crashed* on a full-column press; S71 already recorded that as a port fix and answered it with a polite refusal. Disabling is better still — the refusal never has to happen. The refusal is still there for a stale client.

**Who may press what.** The panel is a public message with **two** legitimate pressers, so "is this your message?" is the wrong question — the right one is "is it your turn?". Everyone else gets a private answer (`⏳ Not your turn.`, `🔴 You are not in this game.`) rather than a silent failure. That is the S98 non-originator rule adapted to a two-owner message.

## One game per channel, and stale games

The cog keys its games by **channel**, not by pair of players, and a game idle for **5 minutes** may be replaced by anyone. Both are ported as-is.

That rule is worth keeping deliberately: it means abandoned games need **no scheduled work at all**. Staleness is only ever evaluated when somebody actually wants the channel, so there is no timer to arm, nothing to re-arm after a restart, and nothing to leak. The old module used a 120-second forfeit timer instead.

A busy channel says how many minutes remain before its game can be taken over.

## The opponent

Leaving the member off (`!connect4`) plays the bot. It is a **scoring heuristic**, ported verbatim from the cog: take an immediate win; block one for 900; own three-in-a-rows 100 each and pairs 10; the opponent's existing threes and pairs 50 and 5; every column that would hand them a next-turn win costs 200; the centre is worth 3 per step closer. Then ±2 of noise, and a random pick among ties.

> **This is deliberately weaker than what it replaces.** S100 built a negamax with alpha-beta and three difficulty levels. The owner was asked directly and chose *"alles van de cog, ook hun bot"* with that trade-off stated, so the stronger opponent was **retired** rather than quietly kept behind the same interface.

Two behaviours hold regardless of the randomness, because both bypass the scoring entirely: the bot **always takes an immediate win**, and **always blocks an immediate loss**. Both are pinned by tests that run against a generator chosen to make every other choice badly.

**Games against the bot do not touch the scoreboard** — a win/loss record is only meaningful against other humans, and the cog's own stats work the same way.

## Staking (M26.2b)

Games are played for donuts, through the same `adjustBalance` seam every other CuffBot game uses.

| Rule | Behaviour |
|---|---|
| **Buy-in** | `betAmount` (default **100**) from each human player |
| **When** | On **accept**, never on invite — an invitation nobody answers costs nothing |
| **Prize** | One random draw in `winMin`–`winMax` (default **400–600**), made at creation so both players see it before committing |
| **Tie** | Both stakes returned — leaving them taken would silently delete two buy-ins per tie |
| **Cancelled before a move** | Refunded |
| **Cancelled mid-game** | Not refunded; abandoning is a surrender, and a free surrender is not one |
| **The bot** | Never pays, never gets paid |

Affordability is checked **before** the panel goes up, so an invitation is never sent for a game that cannot be paid for, and again on accept for the player who did not open it. Nobody is charged when the other player comes up short.

### ⚠️ `betvsbot` — a knob the cog does not have

The cog charges the human and pays out in full when the opponent is its own bot. Against a heuristic with no lookahead that is a repeatable **+300 to +500 donuts per game**, a faucet nothing else in CuffBot's economy comes close to.

The cog's behaviour is the **default**, because the owner asked for the cog. `!minigames betvsbot false` makes bot games free and unpaid in one command, leaving officer-versus-officer staking untouched — so if the precinct's economy starts to drift, the fix is a command rather than a release.

## Configuration

| Key | Default | What it does |
|---|---|---|
| `betAmount` | `100` | Buy-in per human player. `0` disables staking entirely |
| `winMin` / `winMax` | `400` / `600` | The prize range. Each command refuses to cross the other |
| `betVsBot` | `true` | Whether games against the bot cost and pay (see above) |

Stored sparsely under `minigamesConfig` — unset keys follow the defaults, so a later change to a default reaches every guild that never overrode it (the S35 pattern).

## How it works

- **`lib/board.js`** — the generic grid, `findLines` and `tryCompleteLine`, ported from `board.py`. The **scan order** is preserved exactly (horizontals, verticals, then both diagonal families): `findLines` reports the first line it completes, so a reordered scan would highlight a different four on a board containing two. The cog's own comment notes these were written in C# and converted to Python by an LLM — this is the third translation, which is why the port is literal rather than tidied.
- **`lib/connect4.js`** — rules, the heuristic opponent, and rendering. `playColumn` returns new state and never mutates; `random` is injected, so a whole game is reproducible.
- **`lib/tictactoe.js`** — the second game on the same frame. Its opponent is the cog's three lines: complete your own line, else block theirs, else play a random free slot — no lookahead at all, so it walks into forks. **Two deliberate divergences**, both recorded in the file: the cog gives both marks the same red (unreadable with two players on screen), and it hard-codes CROSS to move first, which in a 3×3 game is a real edge — and these games are staked, so the opener is randomised the way Connect 4's already was.
- **`lib/staking.js`** — pure money rules: who pays, what the ledger owes on each ending, and how earnings move. Balances in, decisions out, no economy calls.
- **`runtime.js`** — the shared game runtime. Everything that differs between the two games is a row in one `RULES` table; everything that does not is the code below it. Not under `commands/`, because it is not a command — the loader reads the `index.js` manifest, so a helper can live at the module root without being mistaken for one.
- **`lib/panel.js`** — pure. Takes a session, returns `{content, embed, buttons, done}`. Keeping it pure is what lets a test assert "the button for a full column is disabled" without a gateway.
- **`service.js`** — the channel→session registry (RAM-only, like S71's connect4 and S105's mafia: a duel that survived a restart would resume on a board nobody is still looking at) plus the persisted stats.
- **`commands/open.js`** — the half of both game commands that is identical, so `connect4.js` and `tictactoe.js` differ only in their rules.
- **`runtime.js`'s `settleIfOver`** — pays out **and** records the result **exactly once**, which is what the `finished` flag is for. It pays before it records: the worst case then is a missing stat line, not a missing payout.

## Files

| Path | Role |
|---|---|
| `src/modules/minigames/index.js` | Manifest |
| `src/modules/minigames/lib/board.js` | Generic grid + line finding (ported) |
| `src/modules/minigames/lib/connect4.js` | Rules, the heuristic opponent, rendering |
| `src/modules/minigames/lib/tictactoe.js` | Tic-Tac-Toe's rules and opponent |
| `src/modules/minigames/lib/staking.js` | Pure money rules |
| `src/modules/minigames/lib/panel.js` | Pure panel descriptions for both games |
| `src/modules/minigames/runtime.js` | The shared runtime: `RULES`, payload, settle, stakes |
| `src/modules/minigames/service.js` | Session registry, persisted stats, config |
| `src/modules/minigames/commands/open.js` | The shared open/end handlers |
| `src/modules/minigames/commands/connect4.js` | The `!connect4` group |
| `src/modules/minigames/commands/tictactoe.js` | The `!tictactoe` group |
| `src/modules/minigames/commands/minigames.js` | `!minigames` + `!gameleaderboard` |
| `src/modules/minigames/events/buttons.js` | The panel's button pump, both games |
| `test/minigames-connect4.test.js` | Board, rules and opponent |
| `test/minigames-panel.test.js` | Panel, registry, stats |
| `test/minigames-tictactoe.test.js` | Tic-Tac-Toe's rules, opponent and panel |
| `test/minigames-staking.test.js` | Money rules, leaderboard sorts, config |
| `test/minigames-money.test.js` | Staking end to end through the real economy |

## Testing

- 117 tests. Boards are built by **playing** them, never hand-written — S100 twice pinned a 7×6 position the game cannot reach, because pieces fall.
- **The money is tested twice, on purpose.** `minigames-staking.test.js` pins the pure rules; `minigames-money.test.js` runs the same situations through the real economy seam and asserts actual balances, because a rule the code agrees with and never executes is worth nothing. Four mutations were run against it before it was trusted — a tie that keeps the stakes, a settle with no once-only guard, a refund that does not clear its flag, and a failed buy-in that charges the solvent player anyway. All four were caught.
- One cross-check asserts the **scoreboard against the ledger** rather than each against a literal: a player's recorded `earnings` must equal what their wallet actually did.
- **Owner checklist (live server):**
  1. `!connect4 @someone` → a panel with Accept / Decline. Have a **third** person press Accept → refused privately.
  2. Accept → the board appears with seven buttons. Press one out of turn → `⏳ Not your turn.`, privately, and the panel does not change.
  3. Fill a column → its button greys out.
  4. Win → the four pieces brighten, 👑 appears, the buttons become **Rematch**. Press it → a new game with the colours swapped.
  5. `!connect4` alone → you play the bot; it answers immediately. Set up three in a row → it blocks.
  6. `!connect4 board` → your old scores from before the swap are still there.
  7. Start a game, wait 5 minutes, have someone else run `!connect4` → they take the channel over.
  8. **(S125)** `!ttt @someone` → accept → nine buttons in a 3×3 grid. Win → the three brighten, the board **stays**, a Rematch button appears under it.
  9. **(S125)** With the default buy-in: check `!donuts` before and after a staked win — −100 on accept, +the prize on the win, and the invitation named both numbers up front.
  10. **(S125)** Decline an invitation → nobody was charged. Accept, then `!ttt end` before either player moves → both stakes come back.
  11. **(S125)** `!gameleaderboard winrate` then `!glb earnings` → the same players, reordered.
  12. **(S125)** `!minigames betvsbot false` → `!connect4` alone is now free and pays nothing; `!connect4 @someone` still stakes.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "A game is already running in this channel" | One game per channel, by design | Wait it out (it says how long), or `!connect4 end` if you are a player |
| A press does nothing visible | It answered privately — not your turn, or not your game | Look for the ephemeral reply |
| "That game is over" on a button | The panel outlived its session (usually a restart) | Games are RAM-only by design; start a fresh one |
| My old scores are gone | They should not be — the storage key is unchanged | Check `!connect4 board`; if genuinely empty, the Pi's `data/` was reset |
| The bot plays weakly | Expected, and chosen | The owner picked the cog's heuristic over S100's negamax knowing it is weaker |

## Changelog

| Session | Change |
|---|---|
| S125 (M26.2b) | **Tic-Tac-Toe, staking, and one board for both games.** `!tictactoe` on M26.2a's frame — its board IS the buttons, and it stays on screen when the game ends (the source keeps it too; dropping it would delete the finished game from view). **Donut staking**: 100 in on accept, 400–600 to the winner, refunded on a tie or a pre-move cancel, never charged to a bot. **`!gameleaderboard`** with the cog's four sorts. **`!minigames`** for the record and the four knobs. `!connect4 stats`/`board` removed in favour of the shared surface — both games always wrote to one set of counters. Adds `betvsbot`, which the cog does not have, because the cog's own behaviour is a +300–500 faucet against a heuristic with no lookahead. Fixed on the way: `MODULE_BADGES` still named the `connect4` module S116 deleted, so the roster showed a bullet instead of a badge — and nothing guarded that map against the loader. |
| S116 (M26.2a) | **Replaces the `connect4` module.** Ported from the owner's `minigames` cog: the shared `Board`/`findLines`, Connect 4's rules, the cog's heuristic opponent (verbatim, including its randomness), and **the panel** — invite → accept → play → rematch on one edited message. One game per channel with 5-minute stale takeover, replacing the old forfeit timer. Stats carry over unchanged (`connect4Stats`). The S100 negamax solo AI and its difficulty levels are **retired** by explicit owner decision. |
