# Mafia — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable (Classic · Crazy · Chaos)
**Last updated:** Session 108 · 2026-07-26

## Purpose

Classic mafia (M24.1), ported from AAA3A's `mafiagame` (MIT). Five or more officers sit down; exactly one of them is the Boss. The Boss picks someone off each night, the precinct argues each day and votes someone out, and it ends when one side can no longer lose.

**Three modes, thirteen cards.** The source cog has **57 roles**; this ships the thirteen its Classic, Crazy and Chaos modes actually deal, with the per-player-count tables transcribed from the cog's own `modes.py`. The remaining 44 are a deliberate stopping point: each interacts with every other, so adding them is a design problem rather than a copy-paste one.

| Mode | What is on the table |
|---|---|
| 🏛️ **Classic** | The Boss, the Medic, the Detective, and Officers. One mafia at any size. |
| 🤪 **Crazy** | Classic plus the Vigilante, the Commissioner and the Executioner. |
| 🌀 **Chaos** | Everything: the Tail, the Private Eye, the Distraction, and at 8+ an Enforcer or a Framer. |

`!mafia start chaos` picks one; `!mafia modes` lists them; `!mafia roles chaos` prints only the cards that mode can deal.

## Commands

Playing is open to everyone; the timings and the stats wipe are **Manage Server**.

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!mafia` | Status: whether a table is running here, and the phase lengths | none | Everyone | `!mafia` |
| `!mafia start` | Open a table in this channel | `[classic\|crazy\|chaos]` (default classic) | Everyone | `!mafia start chaos` |
| `!mafia end` | Close the table (host or Manage Server) | none | Host / Manage Server | `!mafia end` |
| `!mafia roles` | What each card does, for one mode | `[classic\|crazy\|chaos]` | Everyone | `!mafia roles chaos` |
| `!mafia modes` | The three tables you can sit at | none | Everyone | `!mafia modes` |
| `!mafia stats` | Your record, broken down by role | `[member]` | Everyone | `!mafia stats @friend` |
| `!mafia board` | The precinct's best liars | `[size]` (1–25) | Everyone | `!mafia board 5` |
| `!mafia timings` | How long a phase lasts | `<phase> <seconds>` (15–1800) | Manage Server | `!mafia timings night 90` |
| `!mafia reset` | Wipe every record | `confirm` | Manage Server | `!mafia reset confirm` |

Aliases: the group answers to `!mafiagame`; `start` takes `play`/`new`, `end` takes `stop`/`cancel`, `roles` takes `cards`, `stats` takes `me`, `board` takes `leaderboard`/`top`. **`!mafia` with an unknown word opens a table** — the group's `fallback` routes it into `start`.

## The cards

| Card | Side | At night |
|---|---|---|
| 🔫 **The Boss** | Mafia | Pick someone to take out |
| 🔪 **The Enforcer** | Mafia | Carries out the order — and **becomes the Boss** if the Boss dies |
| 🖊️ **The Framer** | Mafia | Marks someone; tonight every investigation reads them as mafia |
| 🩺 **The Medic** | Precinct | Protect someone — **never the same person two nights running** |
| 🕵️ **The Detective** | Precinct | Investigate someone; learn whether they are mafia, nothing more |
| 🔦 **The Vigilante** | Precinct | Shoot someone. **If they were innocent, you do not survive the guilt** |
| 🎖️ **The Commissioner** | Precinct | Reveal yourself; from then on **your vote counts twice** |
| 👁️ **The Tail** | Precinct | Follow someone; learn **who they visited**, never what they did |
| 🔍 **The Private Eye** | Precinct | Pick **two** people; learn whether they are on the same side |
| 💃 **The Distraction** | Precinct | Pick someone; **their night action does not happen** |
| 👮 **Officer** | Precinct | Sleeps. Votes by day like everyone else |
| ⚖️ **The Executioner** | Neutral | Marked one villager at the deal. **Wins when the town votes them out** |
| 🃏 **The Jester** | Neutral | **Wins by being voted out.** Never dealt — only reached |

**Neutrals win on their own terms and do not end the game.** A Jester who is lynched has won; the precinct and the mafia carry on without them. That is the cog's model, and it is why a game can have two winners.

**The Executioner's mark is always a villager, never themselves** — marking a crook would make the card a second detective. If the mark dies any way other than a lynch, the Executioner has failed and **becomes a Jester**; their win changed shape rather than vanishing.

Classic is a **one-mafia game at every table size**, 5 to 20; Chaos adds a second crook from 8 players. No mode ever deals a hand where the mafia already outnumbers the precinct — there is a test over every mode at every size asserting it.

## How a game runs

1. `!mafia start` posts the lobby. **Join** / **Leave** / **Start** — only the host starts, and only at 5+.
2. Everyone is DM'd their card. **The game opens on night 1**, not a day: a first day with zero information is a coin flip nobody enjoys.
3. **Night.** Press **Act** and you get a *private* target picker. The shared card only ever says how many people are still to act. When everyone has acted the night ends immediately — a table never waits on a clock the room has already beaten. The Private Eye gets a second picker after their first choice; the Commissioner gets no picker at all, because the press itself is the answer.

   **The order of a night is the whole feature, and it is the cog's:**
   1. **Blocks** — the Distraction goes first, or nothing she stops happens.
   2. **Frames** — the Framer marks before anyone reads anyone.
   3. **Protection** — the medic covers before the shots land.
   4. **Kills** — mafia first, then the Vigilante (who pays for an innocent, but not for a shot the medic blocked — that one never landed).
   5. **Information** — detective, Private Eye and Tail read the state those four steps produced.

   A blocked visitor never went anywhere, so the Tail sees an empty night for them.
4. **Morning.** The victim is named **and their card is revealed**. If the medic guessed right the town is told *somebody* survived an attack, but never who — the medic's whole value is that the Boss cannot tell where the cover went.
5. **The vote.** Press **Vote**, pick privately; the **tally is public**, because that pressure is what the day phase runs on. A **tie puts nobody on trial**.
6. **The trial.** Guilty / Innocent. The accused does not vote, and **a tie acquits**.
7. Repeat until one side wins. Then every card is revealed, alive or dead.

### Winning, stated exactly

- **The precinct wins** when no mafia is left alive.
- **The mafia win at parity** — when they are no longer outnumbered, they can no longer be voted out, so playing it out changes nothing.

The cog states objectives per role ("kill all villagers") rather than writing this rule down in one place. Parity is the near-universal reading and is recorded here as a **stated rule** rather than left implicit.

## Events

`InteractionCreate`, filtered to the `mf:` prefix — a module-owned pump, since CuffBot has no slash commands (S68).

**This is the S98 non-originator rule at its sharpest.** A mafia table is a public message whose every meaningful interaction is per-viewer and secret. So: the shared card is edited only to show **public** state (who joined, the tally, how many still owe an action), and everything a single player chooses is answered **privately** with `flags: 64`. Editing the shared card on a private press would leak the game outright.

The things that go by **DM** are the role reveal, the detective's result, the Private Eye's comparison, the Tail's movement report, a "you were blocked" note, and an Executioner learning they are now a Jester. The S54 no-DM rule is about `!command` *replies*; a game secret is not a command reply, and shouting it in the channel would end the game. If a DM fails, the channel gets a *pointer* — never the content.

## Configuration

No env vars. Per-guild settings live under `mafiaConfig` and are **sparse** (S35).

| Key | Default | Effect |
|---|---|---|
| `lobbyMs` | `5m` | How long the lobby waits before closing itself |
| `nightMs` | `2m` | Night length, if somebody never acts |
| `dayMs` | `3m` | Discussion before voting opens |
| `votingMs` | `90s` | The vote |
| `judgementMs` | `45s` | The trial |

Stats live under `mafiaStats`: games, wins, and a per-role breakdown.

## Permissions & safety

- **Bot permissions needed:** Send Messages, Embed Links and Read Message History in the channel. No privileged intent beyond what every `!command` already needs.
- **Member permissions:** anyone may start or join a table; `timings` and `reset` are Manage Server. `end` is the **host or** Manage Server (or the guild owner).
- **Games are RAM-only, and a restart ends them.** A mafia game is a live hour-long conversation; a restart leaves the room rather than resuming a half-state nobody re-agreed to. Stats persist immediately. This is the same call connect4 made in S71, for the same reason.
- **No pings.** Every card carries `allowedMentions: { parse: [] }`; the only exception is the "I could not DM you" pointer, which pings exactly the one person who needs to see it.
- **Nothing about a live game is ever written to disk**, so a dropped card cannot leak through the data file.

## How it works

- **`lib/roles.js` (pure):** the four cards, `dealRoles(count, random)` with an **injected** random source so every deal is pinnable, and a Fisher–Yates `shuffle` that never mutates its input.
- **`lib/game.js` (pure, `now` and `random` injected):** the whole state machine — `createGame`, `joinGame`, `startGame`, `submitNightAction`, `resolveNight`, `openVoting`, `castVote`, `closeVoting`, `castJudgement`, `closeJudgement`, `checkWinner`. **Every mutator returns a new state plus the events it produced**; this file never speaks and never stores.
- **The night resolves protection before the attack**, which is the cog's order and the reason a right guess by the medic saves outright.
- **An investigation is returned as a private event, not applied to the board.** Information is the whole game, so nothing about the shared state may carry it — there is a test asserting the serialised state contains no trace of it.
- **`lib/render.js` (pure):** every embed and every button descriptor. Keeping the wording out of the command file is what lets tests assert that the night card never names an actor.
- **`flow.js`:** the only file that posts, edits and arms timers. One message per table, edited in place.
- **Timers are injectable** (`armPhaseTimer`), so the suite runs instantly — a game whose phases are minutes long is untestable with real ones (S99).

## Files

| Path | Role |
|---|---|
| `src/modules/mafia/index.js` | Manifest |
| `src/modules/mafia/lib/roles.js` | The four cards + dealing |
| `src/modules/mafia/lib/game.js` | The pure state machine |
| `src/modules/mafia/lib/render.js` | Every embed and button descriptor |
| `src/modules/mafia/lib/config.js` | Phase lengths |
| `src/modules/mafia/service.js` | RAM tables, persisted stats, phase timers |
| `src/modules/mafia/flow.js` | Posting, phase advancement, DMs |
| `src/modules/mafia/commands/mafia.js` | The `!mafia` group |
| `src/modules/mafia/events/buttons.js` | The `mf:` pump |
| `test/mafia.test.js` | Coverage |

## Testing

- **Automated:** `npm test` — `test/mafia.test.js` (35 tests), every one playing a real game with injected `random` and `now` and **nothing that waits**: the deal is one mafia at every size from 5 to 20 and refused outside them; the shuffle keeps the multiset and never mutates its input; the lobby refuses duplicates, short hands, double starts and the host leaving; every night-action refusal (self-kill, repeat-protect, acting dead, acting on a corpse, an Officer having nothing to do); protection resolving before the attack both ways; the death recording its cause; a quiet night not crashing; **the investigation being private and leaving no trace in the state**; the tally ignoring abstentions while still recording them; a tie putting nobody on trial and a tie acquitting; parity ending the game rather than extinction; a full game start-to-reveal; and a finished game refusing every further move. Then presentation: button ids round-tripping while a foreign prefix falls through, the buttons matching the phase, **the night card never naming the actor or the target**, a save announced without naming who, the target list obeying the same rules the engine does, and the stats counting per role.
- **Manual (live server) checklist** — this is the one module whose real behaviour cannot be proven from the build environment:
  1. `!mafia start` → the lobby card. Four friends press **Join**; the host presses **Start**.
  2. Everyone gets a DM with their card. If someone does not, the channel says so with their name.
  3. **Act** as the Boss → a private picker only you can see. As an Officer → "you sleep tonight".
  4. Once all three actors have acted the day arrives **immediately**, without waiting out the clock.
  5. The detective gets a DM naming their result; nobody else sees it.
  6. Vote → the tally updates on the shared card. Tie → "nobody stands trial".
  7. Lynch the Boss → the precinct wins and every card is revealed.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "I could not DM you your card" | That member's DMs are closed | They open DMs; the host restarts the table |
| The **Start** button says you need 5 | Classic does not work below five | More players, or wait |
| A press answers "That table is closed" | The game ended, or the bot restarted | `!mafia start` opens a new one |
| The game vanished after an update | Games are RAM-only by design | Expected — the self-update restarts the bot. Stats are kept |
| A phase drags on | Somebody never acted and the clock is running | `!mafia timings night 60` shortens it; the phase always ends |
| Nobody ever goes on trial | Votes keep tying, which puts nobody on trial | That is the rule — it is in the vote card's own text |

## Changelog

| Session | Change |
|---|---|
| S108 | The second tier (M24.2): nine more cards — Enforcer, Framer, Vigilante, Commissioner, Tail, Private Eye, Distraction, Executioner and Jester — plus the **Crazy** and **Chaos** modes with the cog's per-player-count tables. Ordered night resolution (block → frame → protect → kill → read) with a visit log the Tail reads. Neutrals win personally without ending the game. **Bug found by the new suite: succession only ran at night, so a lynched Boss left an Enforcer who could never shoot** — it now follows any death. 58 tests. |
| S105 | Created (M24.1, ported from AAA3A `mafiagame`, MIT). Classic mode only: the Boss, the Medic, the Detective and Officers, 5–20 players. Full night/day/vote/trial state machine, pure with injected `random` and `now`. Private per-player pickers via ephemeral components (S98), role reveal and investigation results by DM. Parity win rule stated explicitly. 35 tests, none waiting on a timer. |
