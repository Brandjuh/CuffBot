# Hangman — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 72 · 2026-07-25

## Purpose

Solo interrogation practice: hangman against the bot, ported from FlameCogs/hangman (owner request, S65 batch → M16.4). The bot picks a word from the bundled 4,554-word list; you type single letters in the channel to solve it before the ASCII gallows (the cog's exact seven frames) fill up.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!hangman` | Group: start/stop a game, board style; bare = how-to + channel state | subs below | Everyone (`edit` is admin) | `!hangman play` |

### !hangman (S69-style group; public)

Bare `!hangman` = a short how-to, the board style, whether THIS channel has a running game, and the intent state. Subcommands:

| Subcommand | Does |
|---|---|
| `!hangman play` (alias `start`) | Start a game: the bot picks a word and posts the gallows board |
| `!hangman stop` (alias `giveup`) | Give up your own running game — reveals the word (not in the cog; added because our engine is event-driven and a walked-away game would otherwise hold the channel for 60 s) |
| `!hangman edit <on\|off>` | **Admin (Manage Server):** one edited board message + guess messages tidied away (`on`, default) vs a new message per guess (`off`) — the cog's `doEdit` |

- **Guessing:** type a **single letter** in the channel. Only the player who started the game is heard; anything longer than one character, or not a–z, is ignored. Repeat guesses are free (the board says so); non-letter characters in the word (apostrophes, hyphens) are auto-revealed.
- **Clock and gallows:** 60 s per guess — silence ends the game with the cog's exact "Canceling selection." message. Each wrong letter draws the next gallows frame; the **6th wrong guess** shows the X-eyes frame and "Game Over" with the word. Solving it prints "You win!".
- **Failure modes:** starting while a game runs in the channel → refusal (one game per channel); starting without the Message Content intent → refusal naming the cause (the bot could never see the guesses); `stop` by anyone but the starter → refusal.

## Events

- `MessageCreate` — the guess watcher: filters to an open game's channel, the starting player, and single a–z letters; deletes the guess after ~200 ms in edit mode (permission failures silently ignored, exactly like the cog).

## Configuration

- `hangmanConfig` in the guild store: `{ doEdit: true }` (sparse override via `!hangman edit`). The cog's custom-wordlist feature is **deliberately not ported** — the Pi deployment has no owner-facing way to drop extra `.txt` files; the bundled list ships in-repo (`src/modules/hangman/data/words.txt`, covered by the S24 packaging test). Recorded deviation; easy to add later if the owner asks.
- Timing constants in `service.js`: `GUESS_TIMEOUT_MS` 60 s (cog-faithful).

## Permissions & safety

- **Bot permissions:** sending/editing its own messages; **Manage Messages** only improves edit mode (guess tidy-up) — missing it degrades silently, never errors.
- **Member permissions:** `play`/`stop` public; `edit` gated on Manage Server (framework gate; the cog used guild-owner — our admin convention, recorded deviation).
- Needs the **Message Content intent** to read guesses; `play` refuses cleanly without it (S38 rule: never start an unwinnable game).
- Games are RAM-only: a restart ends the open game silently; nothing about games is persisted (the cog keeps no stats either).

## How it works

- `lib/game.js` (pure): the seven gallows frames **byte-for-byte** (incl. trailing spaces and literal backslashes), the cog's `_get_message` mask port (`maskWord`), `applyGuess` (repeat/wrong/lost/good/won), `isLetter` (the cog's exact accept check), the board renderer with the cog's exact win/lose/timeout lines, and the wordlist loader (cached, injectable for tests).
- `service.js`: one game per channel in a RAM map; per-guess 60 s timer (single, re-armed, `unref`'d); the `doEdit` config.
- `commands/hangman.js` starts/stops and arms the first timer; `events/watch.js` plays every subsequent turn and re-arms it.

## Files

```
src/modules/hangman/
  index.js            manifest
  lib/game.js         pure rules: frames, mask, guess machine, wordlist
  service.js          RAM game map + doEdit config + guess timer
  commands/hangman.js the !hangman group (play/stop/edit)
  events/watch.js     MessageCreate guess watcher
  data/words.txt      the FlameCogs 4,554-word list, verbatim
test/hangman.test.js  frames, mask, guess matrix, wordlist, service, watcher e2e, group
```

## Testing

- `test/hangman.test.js` (12 tests): frame integrity (seven frames, exact joints/beam per frame), mask format (blanks/reveals/non-letters/wrong-list), the guess matrix (case-folding, free repeats, six-wrong loss, apostrophe words), the `isLetter` accept check, board end-state lines, the full 4,554-word list (+ pick bounds), one-game-per-channel + config default, watcher end-to-end (stranger/multi-letter ignored, reveal, repeat note, wrong-list, win, Game-Over at six), and the group (shape + admin gate on `edit`, play refusals incl. missing intent, starter-only stop).
- **Manual (live server) checklist:**
  1. `!hangman play` → the gallows board appears; type letters → the board updates in place and your guesses vanish.
  2. Guess a wrong letter six times → X-eyes frame + "Game Over" + the word.
  3. Win one → "You win!". Type a letter after the game → nothing happens.
  4. `!hangman edit off` → a fresh board message per guess, guesses stay visible.
  5. Wait 60 s mid-game → "Canceling selection. You took too long." + the word.
  6. Have someone else type letters during your game → ignored.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Letters do nothing | No game running, you're not the starter, or the Message Content intent is off | Bare `!hangman` shows all three |
| Guess messages stay visible in edit mode | Bot lacks Manage Messages in that channel | Grant it, or `!hangman edit off` |
| "A game is already running" but nobody is playing | The starter walked away | It self-clears on the 60 s guess timeout; `!hangman stop` also works for the starter |
| The board stopped updating | The board message was deleted mid-game in edit mode | The next guess posts a fresh board message |

## Changelog

| Session | Change |
|---|---|
| S72 | Created (M16.4, FlameCogs port): byte-faithful gallows frames/mask/messages, bundled 4,554-word list, starter-only typed guesses, 60 s/guess, free repeats, auto-revealed non-letters, doEdit board style (`!hangman edit`). Deviations recorded: `stop` sub added; custom wordlists not ported; admin gate = Manage Server instead of guild-owner. |
