# Splitorsteal — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 79 · 2026-07-25

## Purpose

The interrogation room's trust dilemma: Split or Steal, ported from AAA3A-cogs/splitorstealgame (owner request, S65 batch → M16.6). A 60-second open lobby, two contestants drawn at random, one secret choice each — split together and both win, get greedy and pay for it.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!splitorsteal` (aliases `!sos`, `!splitorstealgame`) | Group: start a match; bare = rules + channel state | `play` | Everyone | `!sos play` |

### !splitorsteal (S69-style group; public — the cog has no gate)

Bare `!splitorsteal` = the rules in short and whether THIS channel has a match running (one per channel). Subcommand:

| Subcommand | Does |
|---|---|
| `!splitorsteal play` (alias `start`) | Open the 60-second lobby |

- **Lobby:** an embed with a 🎮 **Join Game** button and the end time as a live Discord timestamp. The window is a **fixed 60 seconds — it never ends early**, no matter how many join (cog behavior). Fewer than two joiners → *"At least two players are needed to play."*
- **The draw:** exactly **two contestants are drawn at random** from all joiners (the cog's choice-remove-choice), announced with a deliberate ping (they have 60 s to act). Everyone else is a spectator.
- **The choice:** the message swaps to **Split** / **Steal** buttons. Only the two contestants can press; each choice is **secret** (quiet confirmation; a repeat press echoes the original choice back). Both in → instant resolution:
  - split + split → *both win* 🤝
  - steal + steal → *both lose* 💥
  - steal vs split → *the stealer wins* 🕶️
- **Timeout:** a silent contestant ends it — *"At least one player has stopped playing."*
- No prize, no persistence, no config — cog-faithful (the pot/economy is deliberately not wired in; the cog has none).

## Events

- `InteractionCreate` — the `sos:` button pump: lobby joins (dupes refused, closed after the window) and the two secret choices (non-contestants get the cog's *"You are not allowed to use this interaction."*).

## Configuration

None — the cog has none. Timings in `lib/game.js`: `JOIN_WINDOW_MS` / `CHOOSE_WINDOW_MS`, both 60 s cog-faithful, injectable for tests.

## Permissions & safety

- **Member permissions:** everything public (the cog has no gate — starting a match is harmless).
- **Pings:** one deliberate scoped ping when the two contestants are announced (they have 60 s); the result line renders mentions without notifying (house no-ping rule — recorded deviation from the cog, which pinged in replies).
- Matches are RAM-only: a restart ends an open match silently; nothing persists.

## How it works

- `lib/game.js` (pure): `pickTwoPlayers` (the cog's exact choice-remove-choice draw) and `resolveSos` (the matrix), both `random`-injectable.
- `service.js`: one match per channel, the join/choose state machine (`joinSos`/`chooseSos` return codes the pump translates to the cog's quiet replies), the choice bridge (`chooseSos` resolves the runner's pending promise when both choices are in — event-driven, no 1 s polling like the cog), and `runSosGame(game, io)` — the whole match against an injected io ({ openLobby, sleep, notEnough, showChoices, timedOut, result }), the russian-roulette engine pattern.
- `commands/splitorsteal.js` builds the real io (embeds with `<t:…:T>`/`<t:…:R>` end times, cog texts — its "loose" typo corrected to "lose", recorded deviation); `events/buttons.js` is the pump.

## Files

```
src/modules/splitorsteal/
  index.js                    manifest
  lib/game.js                 pure draw + matrix
  service.js                  state machine + choice bridge + io runner
  commands/splitorsteal.js    the group, embeds, the real io
  events/buttons.js           sos: button pump
test/splitorsteal.test.js     matrix, draw, state machine, whole scripted matches, group
```

## Testing

- `test/splitorsteal.test.js` (8 tests): the full matrix, the seeded draw (choice-remove-choice, input untouched), join-phase rules (dupes, closed window, one match per channel), choice rules (contestants only, once each, original echoed on repeat), and whole matches through the scripted runner: not-enough-players after the fixed window, three-join two-drawn both-split win, steal-beats-split (+ timestamp pass-through), and the one-silent-contestant timeout (with the unref'd-timer keep-alive). Plus the group shape and busy-channel refusal.
- **Manual (live server) checklist:**
  1. `!sos play` → lobby embed with a live countdown; three people join; nothing happens until the full minute passes.
  2. Two names are announced with a ping; both press secretly → the result line appears immediately after the second press.
  3. Try pressing as a spectator → quiet *"You are not allowed to use this interaction."*; press twice as a contestant → your original choice is echoed.
  4. Let one contestant stay silent → after a minute: *"At least one player has stopped playing."*
  5. `!sos play` while a match runs → refusal.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "A match is already running" but none is visible | The lobby message was deleted mid-match; the RAM match lives | It self-clears when the window ends (max ~2 min); a restart also clears it |
| The lobby never resolves | The bot restarted mid-match (RAM-only) | Start a new match |
| Contestants say their press "did nothing" | They pressed after the choice window closed, or the match ended | The quiet reply says which; start a new match |

## Changelog

| Session | Change |
|---|---|
| S79 | Created (M16.6, AAA3A port): fixed 60 s lobby (never early), random two-contestant draw (choice-remove-choice exact), secret Split/Steal with quiet confirmations, the classic matrix, 60 s choice timeout. Event-driven choice bridge replaces the cog's 1 s polling. Deviations: "loose" typo corrected; pings limited to the contestant announcement. |
