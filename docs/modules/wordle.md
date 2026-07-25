# Wordle — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 83 · 2026-07-25

## Purpose

Word-craft training for the detectives: Wordle, ported from AAA3A-cogs/wordlegame (owner request, S65 batch → M16.10). Guess the secret English word by **typing guesses straight into the channel** — 🟩 right spot, 🟨 in the word elsewhere, ⬛ not in it. Real words only; a wrong word costs nothing. Per-member stats with a guess distribution.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!wordle` (alias `!wordlegame`) | Group: play, stats; bare = rules + your record + intent state | subs below | Everyone | `!wordle play 6` |

### !wordle (S69-style group)

| Subcommand | Does |
|---|---|
| `!wordle play [length] [attempts]` (alias `start`) | Start a game — length 4–11 (default 5), attempts 5–10 (default 6); `!wordle 6` also works (play is the fallback sub) |
| `!wordle stats [@member]` (alias `statistics`) | Games, wins, win rate (two decimals) and the guess distribution — yours or another officer's |

- **Guessing (cog-exact):** after `play`, type words in the same channel. Only messages of exactly the game's length made of letters count (everything else is silently ignored — normal chat continues). A word not in the dictionary gets an ❌ reaction plus a notice that deletes itself after 3 s and **uses no attempt**. Typing `cancel` (any case) gives up and reveals the word.
- **Coloring — the cog's NAIVE rule, copied deliberately (survey mandate):** green = right position; yellow = the letter matches the word at ANY non-green position, **with no duplicate-letter counting** — guessing `eexit` against `crane` shows TWO yellow e's where classic Wordle shows one. Grey = not in the word.
- **Ending:** guessing the word wins ("You won!"); using all attempts loses ("You lost!") — both reveal the word. **The cog's loss check was hardcoded to 6 attempts regardless of the setting — fixed to respect `attempts` (recorded deviation).** Five minutes without a qualifying message times the game out (the cog's wait_for window; invalid words DO reset it, ignored chatter does not).
- **Buttons:** **Explanation** (ephemeral rules card, anyone may press) and **✖️ Cancel** (the player only).
- **Concurrency (cog-exact):** one running game per member (guild-wide), bound to the channel it started in — different members play in parallel, even in the same channel.
- **Stats:** every finished game counts games += 1 — win, loss, cancel AND timeout (cog placement); a win adds to wins and to the distribution slot for the attempts used.

## Events

- `MessageCreate` — the guess watcher (player + channel bound; needs Message Content).
- `InteractionCreate` — the `wd:` button pump (Explanation / Cancel).

## Configuration

- None (the cog has no guild config). Stats in `wordleStats`: `{ players: { [id]: { wins, games, distribution[10] } } }`.
- Word data: `src/modules/wordle/data/words-en.txt` (7,543 answers) + `dictionary-en.txt` (219,855 valid guesses) — the cog's EN lists **verbatim** (every entry is already 4–11 letters); entries are diacritic-folded at load (the cog left `jalapeño` unguessable — folded lists keep every secret typeable) and the literal word `cancel` is skipped (the cog's own skip: it is the quit keyword). Answers are additionally unioned into the dictionary so a secret is always a legal guess.

## Permissions & safety

- **Member permissions:** everything public; no admin surface.
- **Only the starter's messages are read**, and only in the game's channel; the Cancel button refuses others with the cog's exact line (the cog's bot-owner backdoor dropped, as in S82 — recorded deviation).
- **Pings:** none — board edits, notices and reveals never ping.
- Games are RAM-only (a restart drops running games silently); stats persist. **Needs the Message Content intent** — `play` refuses to start without it (S38 rule) and the bare `!wordle` status shows the intent state.

## How it works

- `lib/game.js` (pure): `colorRow` — the cog's coloring loop verbatim (naive yellow pinned in tests), `foldDiacritics` (the cog's DIACRITIC_SYMBOLS inverted), `isGuessShaped` (the wait_for predicate: exact length + unicode letters), `renderGrid` (the emoji board that replaces the cog's Pillow PNG).
- `lib/words.js`: lazy one-time load of both lists, indexed by length (answers array + dictionary Set per length).
- `service.js`: games keyed by `guild:member` (the cog's per-member max_concurrency), `submitGuess` — the guess machine (ended/cancel/ignored/invalid/accepted with win/loss flags flipping synchronously, S22), the fixed loss check, the re-armed 5-minute guess timer, and stats.
- `commands/wordle.js` renders the board embed (cog title/fields; **edited in place** instead of the cog's delete+repost — that was a PNG-attachment artifact, recorded deviation) and owns the finish paths; `events/watch.js` is the collector, `events/buttons.js` the pump.

## Files

```
src/modules/wordle/
  index.js               manifest
  lib/game.js            colors (naive rule), fold, predicate, emoji grid
  lib/words.js           lazy EN lists indexed by length
  service.js             per-member games + guess machine + stats + timer
  commands/wordle.js     the group, board embed, buttons, finish paths
  events/watch.js        typed-guess collector
  events/buttons.js      wd: button pump (Explanation / Cancel)
  data/words-en.txt      7,543 answers (cog list, verbatim)
  data/dictionary-en.txt 219,855 valid guesses (cog list, verbatim)
test/wordle.test.js      colors, fold, grid, lists, machine, loss fix, stats, group
```

## Testing

- `test/wordle.test.js` (10 tests): the naive coloring rule pinned exactly (incl. the double-yellow divergence and the green-blocks-yellow case), diacritic folding + the guess-shape predicate, the emoji grid, the bundled lists (every length 4–11 covered, the 2,377 five-letter answers verbatim, `cancel` skipped, answers always guessable, seeded pick), the guess machine (ignored/invalid-costs-nothing/accepted/win claim), **the fixed loss check at maxAttempts 5 AND 7** (the cog's hardcoded 6 would fail both), cancel, per-member concurrency, stats incl. the distribution slots, and the group shape.
- **Manual (live server) checklist:**
  1. `!wordle play` → the board with 6 empty rows; type `crane` → the row colors in and the counter reads 1/6.
  2. Type gibberish (`zzzzz`) → ❌ + a notice that vanishes in ~3 s, no attempt used; type a 7-letter word → silently ignored.
  3. Win one → "You won!" + the word; `!wordle stats` shows the distribution line.
  4. `!wordle play 4 5` and lose all 5 → **"You lost!" appears** (the cog showed nothing at 5 attempts).
  5. Have someone else press your ✖️ → refused; press Explanation → the rules card, only you see it.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| The bot ignores every guess | Message Content intent off, or you're typing in another channel than the game | Bare `!wordle` shows the intent state; guess where you started |
| "You already have a Wordle game running" | One game per member, guild-wide | Type `cancel` in that game's channel (or press ✖️) |
| A real word was rejected with ❌ | The dictionary decides — 219,855 words, but not slang/names | Try a different word; no attempt was used |
| The game vanished without a result | 5 minutes passed without a qualifying guess, or the bot restarted | The timeout message names the word; RAM-only games don't survive restarts |

## Changelog

| Session | Change |
|---|---|
| S83 | Created (M16.10, AAA3A port): typed-guess Wordle with the cog's EN lists verbatim (lengths 4–11, attempts 5–10), the NAIVE coloring rule copied exactly, invalid words free (❌ + self-deleting notice), cancel word/button, 5-min guess timeout, per-member concurrency 1, stats with guess distribution. **The cog's hardcoded-6 loss check fixed to respect max attempts** (recorded deviation); emoji grid replaces Pillow; board edits in place instead of delete+repost; lists diacritic-folded at load; bot-owner backdoor dropped. |
