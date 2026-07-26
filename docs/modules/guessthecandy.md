# Guessthecandy — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 80 · 2026-07-25

## Purpose

The evidence room's sugar rush: Guess the Candy, ported from AAA3A-cogs/guessthecandygame (owner request, S65 batch → M16.7). A speed round — the scrambled name of a candy on screen, a board of name buttons, first correct press wins on the clock.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!guessthecandy` (alias `!gtc`) | Group: start a round; bare = how-to | `play [difficulty]` | Everyone | `!gtc 12` |

### !guessthecandy (S69-style group; public — the cog has no gate)

Bare `!guessthecandy` = the rules in short. Subcommand:

| Subcommand | Does |
|---|---|
| `!guessthecandy play [difficulty]` (alias `start`) | Start a round. **`play` is the fallback** — `!gtc 8` works without the word. Difficulty = number of buttons, **5–23** (default 5); out of range is refused |

- **A round:** an embed shows the candy's name **scrambled per word** in a code block; below it, `difficulty` candy-name buttons (the answer is ALWAYS among them — the cog's sample-then-choice). **Anyone** may press. Wrong press → the cog's quiet *"You guessed wrong! Try again!"* (retries free). The **first correct press wins**: buttons disable, and a reply pings the winner with the answer and the elapsed time in **two decimals** — the clock starts when the round message lands (cog behavior).
- Rounds auto-close after **3 minutes** (buttons disable, no winner line). **Multiple rounds can run at once** — each lives on its own message (cog behavior; unlike the channel-locked games).
- No prize, no persistence, no config — cog-faithful.

## Events

- `InteractionCreate` — the `gtc:` button pump: guesses by index, the synchronous double-win lock (first correct press flips `ended` before any await — the S22 claim-before-send rule, mirroring the cog's asyncio.Lock), quiet late-press notes.

## Configuration

None — the cog has none. Constants in `lib/game.js`: difficulty 5–23 (default 5), `GAME_TIMEOUT_MS` 180 s, the 23-candy name pool.

## Permissions & safety

- **Member permissions:** everything public.
- **Pings:** only the winner announcement pings, scoped to exactly the winner (cog behavior).
- **Recorded deviation — the shadow images are NOT ported:** the cog bundles 46 PNGs of branded candy products (KitKat, M&M's, Snickers, …). The repo's MIT license cannot license that product imagery, so bundling it into this repo is a redistribution risk the S65 survey flagged. The obscured prompt is a **per-word letter scramble of the name** instead — zero assets, same speed-recognition loop. The 23-name pool itself ports verbatim (naming products as quiz answers is nominative use).
- Rounds are RAM-only; a restart ends open rounds silently.

## How it works

- `lib/game.js` (pure): the 23-name pool, `sampleCandies` (Python `random.sample` equivalent, input untouched), `pickAnswer` (choice — so the answer is always on the board), `scrambleName` (per-word Fisher–Yates, reshuffled until it differs from the input), `formatElapsed` (two decimals).
- `service.js`: rounds keyed by **game id** (not channel — parallel rounds allowed), the 180 s timer, and `pressCandy` with the synchronous win lock.
- `commands/guessthecandy.js` renders the embed + up to 5 rows of 5 buttons; `events/buttons.js` is the pump and posts the winner reply.

## Files

```
src/modules/guessthecandy/
  index.js                      manifest
  lib/game.js                   pool, draws, scramble, elapsed format
  service.js                    rounds by game id + win lock + timer
  commands/guessthecandy.js     the group (play fallback), embed + buttons
  events/buttons.js             gtc: button pump + winner reply
test/guessthecandy.test.js      pool, draws, scramble, state machine, group
```

## Testing

- `test/guessthecandy.test.js` (8 tests): the 23-name pool + bounds, distinct sampling with an untouched pool + answer-on-the-board invariant, the scramble (word boundaries kept, letters identical, result differs), two-decimal formatting, parallel rounds by game id, the press matrix (wrong is free, first correct wins, the ended lock refuses later presses **synchronously**), the seeded round shape, and the group (public, `gtc` alias, `play` fallback, both difficulty bounds refused, 23 buttons = 5 rows, scrambled name in a code block).
- **Manual (live server) checklist:**
  1. `!gtc` → a round with 5 buttons and a scrambled name; press wrong → quiet "Try again!"; press right → pinged congrats with the time.
  2. `!gtc 23` → the full 23-button board (5 rows).
  3. `!gtc 3` and `!gtc 24` → refused with the range.
  4. Start two rounds in one channel → both playable independently.
  5. Leave a round alone 3 minutes → buttons disable quietly.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Buttons answer "That round is over" | The round timed out (3 min) or the bot restarted (RAM-only) | Start a new round |
| The scramble looks almost unscrambled | Short words can only permute so much (2-letter words have one alternative) | Working as designed — speed still decides |
| No winner line after a correct press | The round's message was deleted before the reply landed | The win still counted; start a new round |

## Changelog

| Session | Change |
|---|---|
| S117 | **`!guessthecandy` alone now starts a game** (owner: *"hangman werkt niet zoals het hoort"*). The source cog is a plain command, so the bare word plays; ours was a group from birth and answered with a menu. `!guessthecandy help` still lists the family. |
| S80 | Created (M16.7, AAA3A port): 5–23 name buttons (answer always on the board), first correct press wins with two-decimal timing, free retries, 180 s rounds, parallel rounds per message, winner pinged. Recorded deviation: the 46 branded shadow/candy PNGs are not bundled (license risk flagged in S65) — the prompt is a per-word name scramble instead; the 23-name pool ports verbatim. |
