# Russianroulette — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 73 · 2026-07-25

## Purpose

The precinct's most reckless team-building exercise: russian roulette, ported from AAA3A-cogs/russianroulettegame (owner request, S65 batch → M16.5). A mod opens a lobby, up to 30 officers join by button, and each round one chambered shot goes around — last one standing wins. No prizes, no stats, pure nerve.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!russianroulette` (alias `!rr`) | Group: open a lobby; bare = how-to + channel state | subs below | Everyone (`play` is mod-only) | `!rr play` |

### !russianroulette (S69-style group)

Bare `!russianroulette` = the rules in short and whether THIS channel has a lobby/game (one per channel). Subcommands:

| Subcommand | Does |
|---|---|
| `!russianroulette play` (alias `start`) | **Mod-only (Manage Messages — the cog's gate):** open the lobby. The host auto-joins |

- **Lobby (buttons):** 🎮 Join Game (max 30, duplicates refused) · Leave · View Players (quiet list) · **Start Game!** (host or Manage Server; needs ≥ 2 players) · ✖️ cancel (host or Manage Server; deletes the lobby).
- **A round:** a round embed announces the survivor count; the order is shuffled and one chamber index is drawn. Each player in turn is pinged with a **Shoot! 🔫** button and **5 seconds** — hesitate and *"I got tired of waiting, so I decided to shoot you myself."* On the chambered turn: **90%** *"💥 BANG! … is dead"*, **10%** misfire — the shot hits a **random other player** instead. Everyone else hears *"Click. Nothing happened."* One bang per round; rounds repeat until one officer remains (👑 winner embed, pinged).
- **Failure modes:** opening a lobby while one exists → refusal; pressing Shoot out of turn → *"You can't shoot for someone else!"* (quiet); start with < 2 players → quiet refusal; buttons of an ended game → quiet "that game is over".

## Events

- `InteractionCreate` — the `rr:` button pump: lobby joins/leaves/list/start/cancel + the per-turn Shoot press (resolved through the service's shot bridge).

## Configuration

None — the cog has none either. Timings in `service.js`: `SHOT_TIMEOUT_MS` 5 s, `DRAMA_MS` 2 s (the pause after "pulled the trigger…"), both cog-faithful and injectable for tests.

## Permissions & safety

- **Member permissions:** the overview is public; `play` requires **Manage Messages** (the cog's mod gate, enforced per-sub by the framework). Start/cancel buttons: the host or Manage Server (the cog's admin check, translated).
- **Pings (recorded deviation):** the cog pinged on every game line; here only the **turn prompt** (load-bearing — 5 seconds to react) and the **winner announce** ping, both scoped to exactly that member. Death/click lines render mentions without notifying (house no-ping rule).
- Games are RAM-only: a restart ends the open lobby/game silently; nothing persists.

## How it works

- `lib/game.js` (pure): seeded Fisher–Yates shuffle, the chamber draw, the 90/10 self-death roll (`random() >= 0.1`, the cog's exact comparison), the misfire-victim pick.
- `service.js`: lobby management (host auto-join, max 30), the **shot bridge** (`awaitShot` returns a promise the button pump resolves; 5 s unref'd timer), and `runGame` — the cog's command body as an engine that talks to Discord ONLY through an injected `io` (`say`/`askShot`/`sleep`), so tests script whole games deterministically.
- **Two upstream bugs fixed (recorded deviations):** (1) the cog mutates the player list while iterating it, silently **skipping the next player after every AFK death** — the engine iterates a snapshot of the round order; (2) when every remaining player died AFK the cog **crashed** on the winner lookup — here the round stops the moment one player remains: you win by outliving the rest, without facing a pointless final turn.
- An AFK death **on** the chambered turn consumes the bullet — no bang that round (cog-faithful).

## Files

```
src/modules/russianroulette/
  index.js                        manifest
  lib/game.js                     pure draws: shuffle, chamber, 90/10, victim
  service.js                      lobby + shot bridge + the io-driven engine
  commands/russianroulette.js     the group, lobby embed/buttons, the real io
  events/buttons.js               rr: button pump
test/russianroulette.test.js      draws, lobby, shot bridge, scripted whole games, group
```

## Testing

- `test/russianroulette.test.js` (8 tests): the pure draws (seeded shuffle on a copy, chamber bounds, the exact `>= 0.1` boundary, shooter-excluded victim pick), the lobby matrix (host auto-join, dupes, the 30 cap, leave, one per channel), the shot bridge (right presser resolves, wrong presser rejected, timeout), and four **scripted whole games** through the engine: clean kill → winner; misfire kills the right other player; the AFK **skip-bug fix** (the next player still gets their turn); the AFK **crash fix** (last survivor wins without a final turn); AFK on the chamber consumes the bullet. Plus the group shape (mod gate per-sub, alias, busy refusal).
- **Manual (live server) checklist:**
  1. As a mod: `!rr play` → lobby appears; two accounts join; Start → round 1 announces.
  2. Take a turn → the ping + Shoot button; press within 5 s → "pulled the trigger…" then Click or BANG.
  3. Ignore a turn → after 5 s the bot shoots that player; the NEXT player still gets a turn.
  4. Play to the end → winner embed pings the survivor; the channel is free again.
  5. Non-mod `!rr play` → refusal. Pressing Shoot on someone else's turn → quiet refusal.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "There is already a lobby or game" but nothing is visible | The lobby message was deleted; the RAM game lives | ✖️ was the intended path; a restart clears it — or finish/AFK-out the running game |
| The Start button refuses | You are neither the host nor Manage Server, or fewer than 2 players joined | The quiet reply names which |
| Turn prompts don't ping | The player has mentions muted for the channel | The scoped ping is sent; check notification settings |
| The game froze mid-round | The bot restarted (RAM games end silently) | Open a new lobby |

## Changelog

| Session | Change |
|---|---|
| S73 | Created (M16.5, AAA3A port): mod-opened button lobby (max 30), shuffled rounds with one chambered shot, 5 s Shoot turns (AFK = the bot shoots you), 90/10 misfire onto a random other player, last-standing winner. Upstream fixes: AFK no longer skips the next player (snapshot iteration); everyone-AFK no longer crashes (last survivor wins outright). Deviation: pings limited to turn prompts + winner. |
