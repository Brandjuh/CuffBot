# Rollout — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 81 · 2026-07-25

## Purpose

The precinct's biggest table: Rollout, ported from AAA3A-cogs/rolloutgame (owner request, S65 batch → M16.8). Up to 50 officers; every round each survivor secretly picks one of 25 numbers before the clock — the bot's rolled number eliminates everyone who picked it AND everyone who hesitated. Rolled numbers stay off the board. Last one standing takes the prize.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!rollout` (alias `!rolloutgame`) | Group: lobby, leaderboard, admin knobs; bare = rules + config + your record + channel state | subs below | Everyone (`prize`/`economy`/`resetleaderboard` admin) | `!rollout play` |

### !rollout (S69-style group)

| Subcommand | Does |
|---|---|
| `!rollout play` (alias `start`) | Open the lobby — **anyone may host** (the cog has no gate) |
| `!rollout leaderboard` (alias `lb`) | Score/wins/games top-15 with medals + your place in the footer |
| `!rollout prize <1000–50000>` | **Admin:** the winner's prize (default **2500** — the cog's CODE default; its help text falsely says 5000) |
| `!rollout economy <on\|off>` | **Admin:** also pay the prize in 🍩 through the economy (the cog's `red_economy`, default off) |
| `!rollout resetleaderboard` | **Admin:** wipe the scoreboard |

- **Lobby (buttons):** 🎮 Join (max 50, host auto-joins) · Leave · View Players · **Start Game!** (host or Manage Server, ≥ 2 players) · ✖️ cancel. Every joiner's `games` stat counts at start.
- **A round:** the alive players are pinged once (scoped — 30 s to act) above a board of **25 number buttons** (previously rolled numbers disabled). Picks are per player, once each, quietly confirmed; a picked number's button turns blue (with a count when shared) and the pending-players line shrinks — **the round ends early when everyone has picked** (cog behavior). Then the pre-rolled number turns red and the results embed lists who fell and why (picked it / too slow), never pinging.
- **Edge cases (cog-faithful, per the S65 survey):**
  - **Everyone eliminated at once, with at least one pick on the rolled number** → the round *restarts*: same players, the number stays **enabled**, the round counter doesn't advance.
  - **Nobody picked anything at all** → *"No one has answered in time. The game ends..."* — the game aborts, nobody is paid.
  - **24 numbers disabled with 2+ players alive** → **a tie** (*"It's a tie! No one won the game."*). **The cog CRASHED here** (it dereferenced a `None` winner before its tie embed) — recorded port fix.
- **Winning:** score += prize and wins += 1 on the scoreboard; with `economy on` the same amount is paid in 🍩 through the economy seam (a broken economy module degrades to scoreboard-only, never blocks — the S8 seam rule). Winner announce pings exactly the winner.

## Events

- `InteractionCreate` — the `ro:` button pump: lobby controls (the cog's exact quiet texts) + number picks with live board restyling.

## Configuration

- `rolloutConfig` in the guild store: `{ prize: 2500, economy: false }` (sparse overrides via the admin subs). Round timing: `PICK_WINDOW_MS` 30 s (cog-faithful).
- Stats in `rolloutStats`: `{ players: { [id]: { score, wins, games } } }`.

## Permissions & safety

- **Member permissions:** play/leaderboard public; prize/economy/resetleaderboard gated on Manage Server (per-sub framework gates; the cog used admin-or-ManageGuild).
- **Pings:** one scoped ping per round to the alive players (30 s window — load-bearing) and the winner announce; results/eliminations render mentions without notifying (house rule; the cog pinged the fallen — recorded deviation).
- Games are RAM-only (a restart ends the running game silently); stats and config persist.

## How it works

- `lib/game.js` (pure): `rollNumber` (choice among non-disabled) and `splitEliminated` (the cog's exact elimination split), both seeded in tests.
- `service.js`: lobby (host auto-join, cap 50), the pick bridge (`pickNumber` resolves the runner's promise when ALL alive players picked — the early round end), config + stats (games at start, score/wins on victory, reset), the economy payout via a lazy `adjustBalance` import wrapped try/catch, and `runRolloutGame(game, io)` — the io-injected engine (third consumer of the S73 pattern; see architecture.md).
- `commands/rollout.js` builds the lobby/board embeds and the real io; `events/buttons.js` is the pump.

## Files

```
src/modules/rollout/
  index.js              manifest
  lib/game.js           pure roll + elimination split
  service.js            lobby + pick bridge + stats/config + engine + payout seam
  commands/rollout.js   the group, embeds/boards, the real io
  events/buttons.js     ro: button pump
test/rollout.test.js    pure rules, lobby, config/stats, four whole games, group shape
```

## Testing

- `test/rollout.test.js` (9 tests): the pure roll/split, the lobby matrix (auto-join, cap 50, leave, one per channel), config defaults (2500/off — with the help-text lie pinned in an assertion), stats reset, and four whole scripted games through the engine: a two-round elimination with stats/leaderboard assertions, the **round-restart** edge (number stays enabled, round counter unchanged), the **all-timeout abort** (nobody paid; with the unref'd-timer keep-alive), and the **24-disabled tie** (the cog's crash case — no winner recorded), plus the economy payout moving real donut balances, and the group's per-sub permission shape.
- **Manual (live server) checklist:**
  1. `!rollout play` → lobby; 2+ join; Start → round 1 pings the players with the 25-number board.
  2. Pick numbers → buttons turn blue live, the pending list shrinks, the round resolves the moment everyone picked.
  3. Survive to the end → winner embed + scoreboard points; `!rollout lb` shows it.
  4. `!rollout economy on` and win again → donuts paid on top (`!donuts` shows it).
  5. Let everyone pick the same (rolled) number → the round restarts with the number still available.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "There is already a lobby or game" but nothing is visible | The lobby message was deleted; the RAM game lives | ✖️ was the intended path; a restart also clears it |
| The round never ends early | Someone alive hasn't picked — the 30 s clock decides | Working as designed |
| Winner got points but no donuts | `economy` is off, or the economy module is disabled | `!rollout` status shows the toggle; `!economy` the module switch |
| Leaderboard shows members who left | Stats keep raw ids; departed members render as unknown mentions | `!rollout resetleaderboard` for a clean slate |

## Changelog

| Session | Change |
|---|---|
| S117 | **`!rollout` alone now starts a game** (owner: *"hangman werkt niet zoals het hoort"*). The source cog is a plain command, so the bare word plays; ours was a group from birth and answered with a menu. `!rollout help` still lists the family. |
| S81 | Created (M16.8, AAA3A port): 50-player lobby, 25-number rounds (30 s, early end when all picked, live board feedback), cog-exact eliminations + edge cases (round restart with the number kept enabled; all-timeout abort; **the 24-disabled tie the cog crashed on — fixed**), prize 2500 (code default; help-text lie documented), economy payout via the adjustBalance seam, score/wins/games leaderboard + admin reset. Pings limited to round-open + winner (deviation). |
