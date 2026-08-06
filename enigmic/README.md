# Enigmic

An original murder-mystery deduction puzzle cog for
[Red-DiscordBot V3](https://github.com/Cog-Creators/Red-DiscordBot).

Players reconstruct a crime scene on a square grid: every suspect and the
victim must be placed so that **every row and every column contains exactly
one character**, nobody stands on blocked furniture, and **every clue is
true**. Once the board is solved, the murderer reveals themselves - the only
suspect alone with the victim in the same room.

## Gameplay

1. Start a case with `[p]enigmic start`. The bot posts a rendered board
   image with the story, the character list, and all clues.
2. Select a character from the dropdown, press **Place**, and enter a
   coordinate such as `B4` (column letter + row number; `A1` is top-left).
3. Use the rules to deduce positions:
   - One character per row and per column.
   - Characters only stand on walkable cells.
   - "Beside" means directly up/down/left/right - never diagonal, and never
     through a wall.
   - North/south/east/west clues compare rows and columns and are not
     blocked by walls. "Directly north" additionally means the same column.
   - Rooms can hold any number of characters.
4. Take notes with **Mark X** (nobody stands here) and **Note** (this
   character cannot stand here). Notes are private bookkeeping - they never
   affect the real rules.
5. Press **Submit** when every character is placed. Solve the arrangement
   and the murderer is unmasked: the single suspect sharing the victim's
   room.

Stuck? **Hint** consults the same constraint solver that validated the case:
it first eliminates an impossible cell, then reveals forced placements, and
only as a last resort reveals a true coordinate.

## Installation

```
[p]load downloader
[p]repo add cuffbotred <repository-url>
[p]cog install cuffbotred enigmic
[p]load enigmic
```

Replace `<repository-url>` with the URL of this repository.

- **Required Red version:** 3.5.0 or newer (discord.py 2.x).
- **Python:** 3.10+.
- **Dependencies:** [Pillow](https://python-pillow.org/) (installed
  automatically by the Downloader via `info.json`).

To expose the slash commands, run `[p]slash enablecog enigmic` followed by
`[p]slash sync` (owner only). Everything also works as prefix commands
without syncing.

## Commands

### Player commands (`[p]enigmic`, aliases: `enigma`, `crimepuzzle`)

| Command | Description |
| --- | --- |
| `enigmic` | Overview and quick help. |
| `enigmic start [difficulty\|case_id]` | Start a case (beginner/easy/normal/hard/expert, a case ID, or automatic). |
| `enigmic daily` | Play today's deterministic daily case. |
| `enigmic daily leaderboard` | Today's daily leaderboard. |
| `enigmic daily status` | Your daily completion and streaks. |
| `enigmic resume` | Repost your active board (e.g. after the message was deleted). |
| `enigmic board` | Show the board plus a text summary (works without embeds). |
| `enigmic place <character> <coordinate>` | Place or move a character. |
| `enigmic remove <character>` | Remove a character from the board. |
| `enigmic mark <coordinate>` | Add a global X mark. |
| `enigmic note <character> <coordinate>` | Toggle a per-character exclusion note. |
| `enigmic clear <coordinate>` | Clear a note or X mark at a cell. |
| `enigmic undo` | Undo the last board action (up to 50). |
| `enigmic hint` | Get a solver-backed hint. |
| `enigmic submit` | Check your complete arrangement. |
| `enigmic abandon` | Abandon the active case. |
| `enigmic rules` | Full rules explanation. |
| `enigmic cases [difficulty]` | List available cases. |
| `enigmic stats [member]` | Puzzle statistics. |
| `enigmic leaderboard [difficulty]` | Server leaderboard. |

Character arguments accept the internal ID, full name, short name, symbol,
or any unique case-insensitive partial name.

### Administrator commands (`[p]enigmicset`)

Requires admin or Manage Server.

| Command | Description |
| --- | --- |
| `enigmicset enabled <true\|false>` | Enable/disable the cog per server. |
| `enigmicset channel add/remove/list` | Restrict play to specific channels. |
| `enigmicset hints <true\|false>` | Enable/disable hints. |
| `enigmicset hintlimit <n>` | Hints per case (0 = unlimited). |
| `enigmicset hintautoplace <true\|false>` | Auto-place forced/strong hint results. |
| `enigmicset hintdetails <true\|false>` | Name the contradicting placement in hints. |
| `enigmicset feedback <generic\|count\|detailed>` | Wrong-submission feedback detail. |
| `enigmicset timeout <minutes>` | Inactivity timeout for games (0 = never). |
| `enigmicset timezone <IANA tz>` | Timezone for the daily case (default UTC). |
| `enigmicset daily <true\|false>` | Enable/disable daily cases. |
| `enigmicset showsettings` | Show the current configuration. |
| `enigmicset case list/info/import/export/validate/remove/enable/disable` | Custom-case management. |

## Case JSON format

Cases are JSON documents. The important parts:

```json
{
  "schema_version": 1,
  "id": "my_case",
  "title": "My Case",
  "difficulty": "normal",
  "story": "Someone was found...",
  "size": 6,
  "rooms": [
    {"id": "gallery", "name": "Gallery", "cells": ["A1", "A2", "B1", "B2"],
     "render_label_cell": "A1"}
  ],
  "blocked_cells": ["C3"],
  "cell_features": {"B3": ["red_rug"]},
  "objects": [
    {"id": "bronze_statue", "name": "bronze statue", "cell": "C4",
     "blocks_movement": true, "symbol": "ST"}
  ],
  "walls": [["B2", "B3"]],
  "characters": [
    {"id": "victim_arthur", "name": "Arthur Bell", "short_name": "Arthur",
     "role": "victim", "symbol": "V", "description": "The curator."},
    {"id": "suspect_evelyn", "name": "Evelyn Price", "short_name": "Evelyn",
     "role": "suspect", "symbol": "E", "description": "Security manager."}
  ],
  "victim_id": "victim_arthur",
  "clues": [
    {"owner": "suspect_evelyn", "type": "in_room", "room_id": "gallery",
     "text": "Evelyn was seen in the Gallery."},
    {"owner": "victim_arthur", "type": "any_of", "constraints": [
       {"type": "in_room", "room_id": "gallery"},
       {"type": "in_room", "room_id": "hall"}
     ], "text": "Arthur was found either in the Gallery or the Hall."}
  ],
  "solution": {"suspect_evelyn": "A1", "victim_arthur": "B2"},
  "killer_id": "suspect_evelyn"
}
```

Key rules:

- Coordinates combine a column letter (`A` = west) and a row number
  (`1` = north): `A1` is top-left.
- An `N`x`N` case has exactly `N` characters: `N - 1` suspects plus one
  victim. Sizes 4-8 are supported.
- Every cell must belong to exactly one room. Walls are pairs of adjacent
  cells and block "beside" relationships only.
- Every character (victim included) needs at least one clue, and each clue
  contains machine-readable fields plus display `text` - the text is never
  parsed.
- Supported clue types: `in_room`, `not_in_room`, `in_row`, `not_in_row`,
  `in_column`, `not_in_column`, `on_feature`, `not_on_feature`,
  `beside_character`, `not_beside_character`,
  `north/south/east/west_of_character`,
  `directly_north/south/east/west_of_character`, `same_room_as_character`,
  `different_room_from_character`, `beside_object`, `not_beside_object`,
  `north/south/east/west_of_object`, `in_same_room_as_object`,
  `not_in_same_room_as_object`, and the compounds `all_of`, `any_of`,
  `exactly_one_of`.
- The victim's room in the solution must contain exactly one suspect, and
  that suspect must be `killer_id`.
- **Some character-to-character clues are structurally degenerate.** Every
  row and every column holds exactly one character, so no two characters can
  ever share a row or a column. That makes these impossible to satisfy —
  a case using any of them has no solution:
  `beside_character`, `directly_north_of_character`,
  `directly_south_of_character`, `directly_east_of_character`, and
  `directly_west_of_character`. Their mirror image,
  `not_beside_character`, is always true and so tells the player nothing.
  The importer rejects the impossible ones and warns about the vacuous one.
  All of these clue types remain fully implemented and are meaningful in
  their `*_object` form: objects are not bound by the row/column rule, so
  object clues are also the only way a wall can affect a clue's truth.

## Importing cases

1. Author the JSON (the `tools/generate_case.py` development utility can
   generate solver-validated cases from a board skeleton - review its
   output manually before publishing).
2. Attach the file to `[p]enigmicset case import`.
3. The importer parses the JSON safely (never executing anything), checks
   the schema, coordinates, references, and clues, verifies the murderer
   rule, and **runs a constraint solver that must prove the puzzle has
   exactly one solution**. Ambiguous, unsolvable, or overly complex cases
   are rejected with a readable report.

### The unique-solution validator

The validator never trusts the stored solution: an independent backtracking
solver searches the entire arrangement space (rows/columns/blocked cells/
clues/murderer rule) and stops after finding two solutions. A case is only
accepted when the search proves exactly one arrangement exists and that it
matches the stored solution. The solver runs with node and time budgets so
a malicious or degenerate case cannot stall the bot.

## Privacy

This cog stores per-user: Discord user ID, puzzle progress (the active
game), completion statistics, and daily records. It stores no message
content, emails, IP addresses, or tokens. Red's standard user data deletion
(`red_delete_data_for_user`) removes active games, statistics, daily
records, and leaderboard entries.

## Troubleshooting

- **Slash commands missing** - run `[p]slash enablecog enigmic` and
  `[p]slash sync`; prefix commands always work.
- **The board image looks wrong after an update** - the image is cached per
  case; reload the cog (`[p]reload enigmic`) to clear caches.
- **"This board belongs to a finished or expired case"** - the message
  belongs to an older game; use `[p]enigmic resume` for a fresh board.
- **Import rejected as too complex** - the solver budget guards the bot;
  simplify the case or add stronger clues.
- **Games expire unexpectedly** - raise `[p]enigmicset timeout`.

## Development and testing

No test requires a Discord connection. The suite has two tiers.

**Game logic only** — coordinates, constraints, solver, validator, game
state, renderer, and re-validation of every bundled case. This tier runs
without Red installed, which is itself a guarantee the puzzle engine never
grows a Red dependency:

```
pip install pillow pytest
python -m pytest enigmic/tests
```

**Including the Discord layer** — additionally instantiates the cog with a
real `Config` over a temporary data directory and asserts the payload
limits that only surface at runtime (application-command descriptions and
nesting, component and select-option limits, modal limits, and embed field
and total sizes for every bundled case). These tests skip automatically
when Red is absent:

```
pip install pillow pytest "Red-DiscordBot>=3.5.0"
python -m pytest enigmic/tests
```

Both tiers run in CI on every push and pull request.

## Credits

Enigmic is an original implementation of a murder-deduction puzzle format.
All bundled cases, characters, stories, maps, clue texts, and artwork are
original creations for this cog; nothing is copied from any commercial
puzzle game, and no proprietary assets are included.
