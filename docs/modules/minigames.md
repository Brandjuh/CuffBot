# Minigames 🔴

Panel-driven minigames, ported from the `minigames` cog in [`Brandjuh/FireAndRescueAcademyCogs`](https://github.com/Brandjuh/FireAndRescueAcademyCogs/tree/main/minigames) (M26.2, owner request: *"Connect4: Vervang deze met …"*).

**This module replaces the S71/S100 `connect4` module outright.** Scores carry over — the storage key is unchanged.

## At a glance

| | |
|---|---|
| **Commands** | `!connect4` (aliases `!c4`) — bare form opens a panel |
| **Category** | games |
| **Permissions** | none; everything is public |
| **Storage** | `connect4Stats` (per guild) — the same key the old module used |
| **Source** | `Brandjuh/FireAndRescueAcademyCogs/minigames` (M26.2a: Connect 4; Tic-Tac-Toe and staking in M26.2b) |

## Commands

| Command | What it does | Args | Who | Example |
|---|---|---|---|---|
| `!connect4` | Open a panel against the bot | none | Everyone | `!connect4` |
| `!connect4 @officer` | Challenge someone — they must accept | `<member>` | Everyone | `!connect4 @Vance` |
| `!connect4 stats` | Your record, or someone else's | `[member]` | Everyone | `!connect4 stats @Vance` |
| `!connect4 board` | The precinct leaderboard | none | Everyone | `!connect4 board` |
| `!connect4 end` | End the game in this channel | none | Everyone* | `!connect4 end` |

\* A game that is still being played may only be ended by its two players. A **stale** one (see below) may be ended by anyone.

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

## Configuration

None yet. Bet amounts and win ranges arrive with staking in M26.2b.

## How it works

- **`lib/board.js`** — the generic grid, `findLines` and `tryCompleteLine`, ported from `board.py`. The **scan order** is preserved exactly (horizontals, verticals, then both diagonal families): `findLines` reports the first line it completes, so a reordered scan would highlight a different four on a board containing two. The cog's own comment notes these were written in C# and converted to Python by an LLM — this is the third translation, which is why the port is literal rather than tidied.
- **`lib/connect4.js`** — rules, the heuristic opponent, and rendering. `playColumn` returns new state and never mutates; `random` is injected, so a whole game is reproducible.
- **`lib/panel.js`** — pure. Takes a session, returns `{content, embed, buttons, done}`. Keeping it pure is what lets a test assert "the button for a full column is disabled" without a gateway.
- **`service.js`** — the channel→session registry (RAM-only, like S71's connect4 and S105's mafia: a duel that survived a restart would resume on a board nobody is still looking at) plus the persisted stats.
- **`commands/minigames.js`** — opens the panel; `settleIfOver` records the result **exactly once**, which is what the `finished` flag is for.

## Files

| Path | Role |
|---|---|
| `src/modules/minigames/index.js` | Manifest |
| `src/modules/minigames/lib/board.js` | Generic grid + line finding (ported) |
| `src/modules/minigames/lib/connect4.js` | Rules, the heuristic opponent, rendering |
| `src/modules/minigames/lib/panel.js` | Pure panel description |
| `src/modules/minigames/service.js` | Session registry + persisted stats |
| `src/modules/minigames/commands/minigames.js` | The `!connect4` group |
| `src/modules/minigames/events/buttons.js` | The panel's button pump |
| `test/minigames-connect4.test.js` | Board, rules and opponent |
| `test/minigames-panel.test.js` | Panel, registry, stats |

## Testing

- 46 tests. Boards are built by **playing** them, never hand-written — S100 twice pinned a 7×6 position the game cannot reach, because pieces fall.
- **Owner checklist (live server):**
  1. `!connect4 @someone` → a panel with Accept / Decline. Have a **third** person press Accept → refused privately.
  2. Accept → the board appears with seven buttons. Press one out of turn → `⏳ Not your turn.`, privately, and the panel does not change.
  3. Fill a column → its button greys out.
  4. Win → the four pieces brighten, 👑 appears, the buttons become **Rematch**. Press it → a new game with the colours swapped.
  5. `!connect4` alone → you play the bot; it answers immediately. Set up three in a row → it blocks.
  6. `!connect4 board` → your old scores from before the swap are still there.
  7. Start a game, wait 5 minutes, have someone else run `!connect4` → they take the channel over.

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
| S116 (M26.2a) | **Replaces the `connect4` module.** Ported from the owner's `minigames` cog: the shared `Board`/`findLines`, Connect 4's rules, the cog's heuristic opponent (verbatim, including its randomness), and **the panel** — invite → accept → play → rematch on one edited message. One game per channel with 5-minute stale takeover, replacing the old forfeit timer. Stats carry over unchanged (`connect4Stats`). The S100 negamax solo AI and its difficulty levels are **retired** by explicit owner decision. |
