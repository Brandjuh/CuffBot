# Memory — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 82 · 2026-07-25

## Purpose

Photographic-memory training for the precinct: Memory, ported from AAA3A-cogs/memorygame (owner request, S65 batch → M16.9). A single-player button grid — flip two tiles at a time to find every emoji pair. A wrong pair flashes red for a second and hides again. Winning pays a prize that decays with every second and every wrong match, so fast and precise pays best.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!memory` (alias `!memorygame`) | Group: play, leaderboard, admin knobs; bare = rules + config + your record | subs below | Everyone (admin subs: Manage Server) | `!memory play 4x4` |

### !memory (S69-style group)

| Subcommand | Does |
|---|---|
| `!memory play [3x3\|4x4\|5x5]` (alias `start`) | Start a board (default 5x5) — yours alone; `!memory 3x3` also works (play is the fallback sub, like the cog's `!memorygame 3x3`) |
| `!memory leaderboard` (alias `lb`) | Score/wins/games top-15 with medals + your place in the footer |
| `!memory maxwrong <0–50>` | **Admin:** wrong matches allowed per game — one too many loses; **0 = no limit** (default, the cog's None) |
| `!memory maxprize <1000–50000>` | **Admin:** the prize ceiling before decay (default 5000) |
| `!memory decay <perSecond> <perWrong>` | **Admin:** prize decay, each 0–30 (the cog's reduction_per_second 5 / reduction_per_wrong_match 15) |
| `!memory economy <on\|off>` | **Admin:** also pay the prize in 🍩 through the economy (the cog's `red_economy`, default off) |
| `!memory resetleaderboard` | **Admin:** wipe the scoreboard |

- **Boards (cog-exact):** 3x3 = 4 pairs + a disabled invisible center tile; 4x4 = 8 pairs; 5x5 = 12 pairs + center tile. Emoji pool of 12, verbatim from the cog: 🏆 🎯 🎲 ⚽ 🏀 🏓 🥁 🎮 🎳 🎻 🎖️ 🏹.
- **A turn:** the first press reveals a tile in place; the second press either matches (both turn green and stay revealed) or mismatches (both flash **red for 1 second**, then hide again). **Pressing the same tile twice counts as a try AND a wrong match** — a cog quirk, ported faithfully. Matched tiles and the blank ignore presses.
- **Winning:** the whole board reveals green and the embed reports seconds, tries and wrong matches. **Prize (cog-exact):** base = maxPrize scaled ⅓ (3x3) or ⅔ (4x4) with Python `int()` truncation — `int(maxPrize / 3 * 2)`, not `floor(maxPrize/3)*2` — then `max(int((base − seconds·perSecond − wrong·perWrong) · (n/5)), 0)` where n = 3/4/5. Score += prize, wins += 1; with `economy on` the same amount is paid in 🍩 (a broken economy module degrades to scoreboard-only — the S8 seam rule).
- **Losing:** only possible with `maxwrong` set — reaching the limit ends the game with the cog's exact message. No points; **games count once** (at start — the cog's lose() double-counted, recorded deviation).
- **Idle:** a board untouched for 10 minutes silently locks (the cog's View timeout) — no loss recorded.

## Events

- `InteractionCreate` — the `mem:` button pump: tile presses, the mismatch flash, and the win/lose settlement.

## Configuration

- `memoryConfig` in the guild store (sparse overrides): `{ maxWrongMatches: 0, economy: false, maxPrize: 5000, reductionPerSecond: 5, reductionPerWrongMatch: 15 }` — all cog defaults; 0 maxWrongMatches = no limit.
- Stats in `memoryStats`: `{ players: { [id]: { score, wins, games } } }`.

## Permissions & safety

- **Member permissions:** play/leaderboard public; maxwrong/maxprize/decay/economy/resetleaderboard gated on Manage Server (per-sub framework gates; the cog used admin-or-ManageGuild).
- **Only the starter may press their board** — others get the cog's exact "You are not allowed to use this interaction." quietly. (The cog also let bot owners press as a debug backdoor — dropped, recorded deviation.)
- **Pings:** none anywhere; the leaderboard renders mentions without notifying.
- Games are RAM-only (a restart ends running boards silently); stats and config persist. Parallel boards are allowed — each lives on its own message (cog behavior), so the game never blocks a channel.

## How it works

- `lib/game.js` (pure): `buildTiles` (the cog's exact three layouts, seeded in tests) and `computePrize` (the formula above with `Math.trunc` mirroring Python `int()` — expression order preserved).
- `service.js`: config + stats (games at START only, score/wins on victory, reset), the games map keyed by game id, and `pressTile` — the cog's button callback as a **synchronous state machine** (select → match/mismatch/won/lost; ended flips before any await, the S22 claim rule). `finishWin` settles the prize and the economy seam. A `locked` flag drops presses during the mismatch flash (the cog queued them behind an asyncio lock — recorded deviation; prevents interleaved board edits).
- `commands/memory.js` renders the grid (hidden tiles carry the cog's invisible `\u200c` label) and owns the 10-minute idle timer; `events/buttons.js` is the pump.

## Files

```
src/modules/memory/
  index.js              manifest
  lib/game.js           pure board layouts + the decayed-prize formula
  service.js            config/stats + pressTile state machine + win settlement
  commands/memory.js    the group, board renderer, embeds, idle timer
  events/buttons.js     mem: button pump (flash timing lives here)
test/memory.test.js     layouts, formula pins, state machine, loss fix, payout, group shape
```

## Testing

- `test/memory.test.js` (9 tests): the three board layouts (sizes, center blanks, pair counts from the cog pool), the prize formula pinned bit-for-bit (including the `int(5000/3*2) = 3333 ≠ 3332` truncation-order case), the press machine (select/match/mismatch, blank + found ignored, the same-tile-twice quirk, the flash lock), a full scripted 3x3 win with clock injection (65 s → prize 804) and stats, the loss path proving **games count once** (the cog's double-count bug fixed), the economy payout moving real donut balances, config defaults/overrides, reset, and the group's per-sub permission shape.
- **Manual (live server) checklist:**
  1. `!memory play 3x3` → a 3×3 board with a dead center; press two tiles → mismatch flashes red 1 s, then hides.
  2. Match all pairs → everything green + the win embed with seconds/tries/wrong matches and points; `!memory lb` shows it.
  3. `!memory economy on`, win again → donuts paid on top (`!donuts` shows it).
  4. `!memory maxwrong 2`, then miss twice → the lose embed, board locked.
  5. Have someone else press your board → quiet "You are not allowed to use this interaction."

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| The board stopped reacting but no result showed | 10-minute idle timeout hit (cog behavior) — silent lock | Start a new board with `!memory play` |
| Prize seems low | Decay: −5/second and −15/wrong match by default; 3x3 pays ⅓, 4x4 ⅔ of the ceiling | `!memory` status shows the knobs; `!memory decay 0 0` for no decay |
| Winner got points but no donuts | `economy` is off, or the economy module is disabled | `!memory` status shows the toggle; `!economy` the module switch |
| A press during the red flash did nothing | Deliberate: the flash lock drops presses for that second | Press again after the tiles hide |

## Changelog

| Session | Change |
|---|---|
| S117 | **`!memory` alone now starts a game** (owner: *"hangman werkt niet zoals het hoort"*). The source cog is a plain command, so the bare word plays; ours was a group from birth and answered with a menu. `!memory help` still lists the family. |
| S82 | Created (M16.9, AAA3A port): 3x3/4x4/5x5 boards (cog-exact layouts + 12-emoji pool), 1 s mismatch flash, same-tile-twice quirk kept, decayed prize formula bit-for-bit (Python int() order), optional wrong-match limit, score/wins/games leaderboard + admin knobs (maxwrong/maxprize/decay/economy/reset), economy payout via the adjustBalance seam. **The cog's games double-count on a loss was NOT ported** (count once); bot-owner press backdoor dropped; flash-lock replaces the cog's press queue (all recorded deviations). |
