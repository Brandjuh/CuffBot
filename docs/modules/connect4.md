# Connect4 — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 71 · 2026-07-25

## Purpose

The precinct game room's first table: Connect 4 duels between two officers, ported from phen-cogs/connect4 (owner request, S65 batch → M16.3). Challenge someone, drop pieces with buttons on a 7×6 emoji board, four in a row closes the case. Guild-wide scoreboard with medals.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!connect4` (alias `!c4`) | Group: challenge + scoreboard; bare = how-to + channel state | subs below | Everyone | `!connect4 @officer` |

### Solo mode — `!connect4 solo [difficulty]` (S100, owner request)

Play the bot instead of a member. There is **no accept step** — the bot is always ready — so the game starts immediately with you as 🔴 moving first, and the board title says *you vs CuffBot* so a passer-by knows what they are looking at.

| Difficulty | Search depth | Feel |
|---|---|---|
| `easy` | 1 | Takes wins, blocks losses, otherwise plays the centre. Beatable. |
| `normal` (default) | 4 | Sees short combinations. |
| `hard` | 6 | Does not hand you an immediate win, and punishes a loose move. |

**Every difficulty always takes an immediate win and always blocks an immediate loss.** Those two are checked explicitly *before* the search rather than left to it — a depth-1 search would otherwise walk into a loss it could see, which would make `easy` feel broken rather than easy.

Results are recorded in the normal scoreboard, so **CuffBot appears on `!connect4 stats`** like any other player. That is deliberate: its record against the precinct is the interesting part.

`!connect4 @CuffBot` does not open a challenge — it points you at `!connect4 solo`.

### !connect4 (S69-style group; public — no permission gate)

Bare `!connect4` = a short how-to, the precinct's played/ties count, and whether THIS channel is free (one game per channel). Subcommands:

| Subcommand | Does |
|---|---|
| `!connect4 play <@member>` (alias `challenge`) | Open a duel challenge. **`play` is the group's fallback** — `!connect4 @member` works without the word |
| `!connect4 solo [difficulty]` (aliases `bot`, `ai`) | **Play CuffBot** (S100). `easy` / `normal` (default) / `hard` |
| `!connect4 stats` | The precinct scoreboard: games/ties, top-3 by wins with 🥇🥈🥉, your own W/L/T line |

- **Challenge flow:** the challenge embed pings exactly the challenged member (scoped `allowedMentions`) with **Accept ✅ / Decline ❌** buttons; they get **60 s** before it expires. The challenger can withdraw via the Decline button. Refusals: bots, self-challenges, and a channel that already has a game or open challenge.
- **The duel:** the challenge message becomes the board — column header `1️⃣…7️⃣`, pieces ⚪/🔴 (challenger)/🔵 (challenged), 7 numbered column buttons + **Forfeit 🏳️**. Challenger moves first; turns alternate; the board edits in place per move. **120 s without a move forfeits the player on turn.**
- **End states:** four in a row (any direction) wins; a full board is a tie; forfeit/timeout awards the win to the other player. The final board keeps rendering with the result line; buttons are removed.
- **Failure modes (all quiet ephemeral refusals):** pressing a **full column** (the upstream cog CRASHED here — recorded port fix; the turn is not consumed), pressing out of turn, pressing while not in the duel, pressing buttons of an ended game.

## Events

- `InteractionCreate` — the `c4:` button pump (accept/decline, column presses, forfeit). Filters strictly on the customId prefix; foreign components untouched.

## Configuration

None — no admin knobs by design (the cog has none either): timings are the ported constants (`CHALLENGE_TIMEOUT_MS` 60 s, `MOVE_TIMEOUT_MS` 120 s in `service.js`). Stats live in the guild store under `connect4Stats` (`{ played, ties, players: { [id]: { wins, losses, ties } } }`).

## Permissions & safety

- **Bot permissions:** none beyond sending/editing its own messages in the channel where the game is played.
- **Member permissions:** none — the whole group is public.
- Board embeds and result lines never ping (`allowedMentions: { parse: [] }`); the ONE deliberate ping is the challenge to the challenged member, scoped to exactly their id.
- Games are RAM-only: a restart forfeits the open game silently (same rule as trivia rounds — scores/stats always persist, live rounds never do).

## How it works

- `lib/board.js` (pure, no discord.js): board create/drop/win-scan/full/render. Row 0 is the top; `dropPiece` returns the landed row or **-1 on a full column** — the upstream crash became a return value callers must handle.
- `lib/ai.js` (pure, S100): the solo opponent. `chooseMove(board, disc, { depth })` reasons in a deliberate order — **take a win, else block a loss, else search** — and never mutates the caller's board (it searches a copy). The search is negamax with alpha-beta over centre-out column ordering, evaluating every 4-cell window; a window holding both colours is dead and scores nothing, which is why windows are counted rather than pieces. A win found sooner outscores the same win found later, so the bot finishes games instead of shuffling.
- **The bot's turn lives in the service** (`playBotTurn`), returning the same `{ code }` shape as a human's `dropMove`, so the button handler renders a bot move through exactly the same path — including the win and tie endings, which were refactored into one shared `finish()` because in a solo game the winner may be the bot.
- `service.js`: one game per channel in a RAM map (`createChallenge`/`startGame`/`dropMove`/`endGame`, single re-armed `unref`'d timer per game), persistent stats via `updateGuildData`. **Port fix (recorded deviation): ties are actually persisted** — upstream wrote them under a wrong key, so its tie counter never moved.
- `commands/connect4.js`: the group (fallback `play`), the board payload builder, and the move-timeout arming. `events/buttons.js`: the pump — challenge stage (accept starts the game and converts the message into the board), playing stage (moves/forfeit), everything else politely refused.
- The S71 framework addition `group.fallback` routes `!connect4 @user` into `play` with the full token list; named subs always win over the fallback.

## Files

```
src/modules/connect4/
  index.js              manifest
  lib/board.js          pure board rules
  lib/ai.js             the solo opponent (pure)
  service.js            games map + stats store
  commands/connect4.js  the !connect4 group + board rendering + move timer
  events/buttons.js     c4: button pump
test/connect4.test.js   board, state machine, both port fixes, stats, group wiring
test/connect4-ai.test.js the solo opponent, on fixed positions
```

## Testing

- `test/connect4.test.js` (13 tests): stacking + full-column refusal (incl. out-of-range), win detection in all four directions + no-false-positive checks (three in a row, interrupted runs), board rendering, full-board detection, one-game-per-channel, turn order + stranger refusal, full-column keeps the turn, win/tie reporting, **tie persistence** (the fixed bug), top-players ordering, group shape (public, fallback `play`), play-sub refusal matrix + challenge payload (scoped ping), stats + status rendering. Framework fallback covered in `test/group.test.js`.
- `test/connect4-ai.test.js` (18 tests, S100) — every one a **fixed position with a computed answer**, no gateway and no timing. The two properties that must hold at *every* difficulty are checked at every difficulty: takes an immediate win (horizontal, vertical, diagonal) and blocks an immediate loss. The winning columns are **computed by the test**, not hand-listed — the diagonal fixture turned out to have two winning moves, so the honest assertion is "played a winning column". Also: winning beats blocking, never plays a full column, never mutates the caller's board, depth 0 still respects the tactical layer, `hard` never gifts an immediate win, all three difficulties finish inside 3 s (a ceiling, not a benchmark), and the service seam — solo games are marked, `playBotTurn` drops a real piece and hands the turn back, reports its own win, refuses to move out of turn or in a two-human duel, and ends a full board as a tie.
- One fixture worth remembering: a "one cell left" board must have its gap at the **top** of a column. My first attempt put it at the bottom, which is a position Connect 4 cannot reach (pieces fall) and which `legalMoves` correctly reported as a full column.
- **Manual (live server) checklist:**
  1. `!connect4 @someone` → challenge appears pinging them; Accept within 60 s → the board replaces the challenge.
  2. Play a game: pieces alternate 🔴/🔵, board edits in place; press a full column → quiet "column is full" note, your turn remains.
  3. Win a game → 🏆 line, buttons gone; `!connect4 stats` → played +1 and the winner on the board.
  4. Fill a board to a tie → 🤝 line; `!connect4 stats` shows the tie counted (for the guild AND both players).
  5. Let 2 minutes pass mid-game → the player on turn forfeits automatically.
  6. `!c4` (alias) and `!connect4` (bare) → the how-to/status view.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "There's already a game in this channel" but none is visible | The previous game's message was deleted while the RAM game lives | Wait out the 120 s forfeit, or have a player press nothing — the timer clears it; a restart also clears it |
| Buttons answer "That duel is over" | The bot restarted mid-game (RAM games forfeit on restart) | Start a new duel |
| The challenge never pings | The challenged member has mentions off, or the ping was suppressed by channel settings | The scoped mention is sent — check the member's notification settings |
| Stats look unchanged after a tie | Pre-S71 data cannot exist (module is new) — if seen, file a bug | `!connect4 stats` reads the live store; check `data/<guildId>.json → connect4Stats` |

## Changelog

| Session | Change |
|---|---|
| S71 | Created (M16.3, phen-cogs port): challenge → accept (60 s) → 7×6 button duel, 120 s inactivity forfeit, guild scoreboard with top-3 medals. Port fixes: full-column press refuses instead of crashing (turn kept); ties actually persist (upstream wrote a wrong key). Framework: group `fallback` subs (`!connect4 @user` = `!connect4 play @user`). |
| S100 | **Solo mode** (M23, owner request): `!connect4 solo [easy\|normal\|hard]` plays CuffBot. Pure opponent in `lib/ai.js` — an explicit take-the-win / block-the-loss layer over negamax with alpha-beta — so every difficulty is tactically correct and the whole thing is tested against fixed positions. The bot's turn is `playBotTurn` in the service, returning the same shape as a human move; the win/tie endings were unified into one `finish()` because the winner may now be the bot. `!connect4 @CuffBot` points at `solo`. |
