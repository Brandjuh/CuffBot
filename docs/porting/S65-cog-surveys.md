# S65 — Source-cog surveys for the Games Arcade (M16)

Verbatim survey results from the S65 intake (three parallel source readers), kept as the
porting reference. Sources are public repos, re-clonable per session (see STATE.md →
Game-cog sources). Numbers here were read from the actual cog code — ports must match them
unless a deviation is recorded in the module manual.

The two reworks (vrt-cogs/hunting → M16.1, YamiCogs/payday → M16.2) were read directly in
the main session; their mechanics are captured in the ROADMAP entries.

---

## Survey A — AAA3A cogs: guessthecandygame, mafiagame, rolloutgame, russianroulettegame

### guessthecandygame
- GAME: single-message speed quiz — embed shows the black silhouette of a random candy + N buttons with candy names; first correct click wins (elapsed time shown, 2 decimals); wrong click = private "try again" (retries allowed). No prize, no persistence.
- COMMAND: `guessthecandy` (aliases gtc), option difficulty 5–23 (default 5) = number of buttons. No config at all.
- MECHANICS: view timeout 180 s; 23 candy PNGs + 23 silhouettes in data/ (names from filenames); answer always among buttons (`sample` then `choice`); lock guards double-wins; timer starts after send.
- COMPLEXITY: small (~150 LOC). Port note: 46 PNG assets — CHECK THE REPO LICENSE before bundling; otherwise re-theme with our own zero-dep PNG silhouettes (enforcement's encoder).

### mafiagame
- GAME: full Werewolf/Town-of-Salem class game: lobby (join/leave/start + mode select + 5 toggles), creates a fresh `mafia` text channel with per-player overwrites, DMs secret roles, Night→Day loop (night actions via buttons, day talk + weighted vote + optional defense/judgement), ends on a win condition; Game Over embed + achievements + optional economy payout.
- SCALE: 57 roles (199 KB roles.py), 7 modes, 10 anomalies (40%/cycle when enabled), 53 commands, 5 timeouts (perform 60 s, talk 50 s, vote 45 s, defend 30 s, judgement 20 s), min 5 / max 25 players, vote minimum = ceil(alive/2), economy cost 50 / reward 100.
- COMPLEXITY: LARGE (biggest by an order of magnitude). Port plan: engine first (phase loop, vote math, win conditions, mode role-generation, priority resolution) as pure functions; CLASSIC_ROLES (GodFather, Mafia, Doctor, Detective, Villager) first; the other ~50 roles, Horsemen, anomalies, achievements as staged follow-ups. Needs Manage Channels.

### rolloutgame
- GAME: elimination number-picking — lobby (min 2 / max 50); each round 25 numbered buttons, 30 s to secretly pick; bot's pre-rolled number eliminates whoever picked it AND whoever picked nothing; rolled numbers stay disabled; last player wins the prize.
- CONFIG: guild red_economy=false, prize=2500 (code default; help text says 5000 — port 2500), range 1000–50000. Member score/wins/games + leaderboard command.
- EDGE CASES (port faithfully): all-eliminated-with-a-pick → round restarts (number NOT disabled); all-eliminated-by-timeout → game aborts, nobody paid; 24 numbers disabled with >1 player → tie, no payout (the cog CRASHES here — port the tie embed, not the crash).
- COMPLEXITY: small-to-medium (~450 LOC).

### russianroulettegame
- GAME: last-one-standing — lobby (min 2 / max 30, mod-only start, max 1 game/channel); each round: bullet index picked, order shuffled, each player in turn gets a 5 s "Shoot!" button; timeout = the bot shoots them (multiple AFK deaths per round possible); at the bullet: 90% self-death, 10% misfire kills a RANDOM other player; last alive wins (no prize, no stats).
- CONFIG: none.
- COMPLEXITY: small (~250 LOC); needs an explicit round-runner state machine in JS.

---

## Survey B — splitorstealgame, wordlegame, memorygame, city

### splitorstealgame
- GAME: 60 s join window (fixed, never early); exactly 2 random joiners drawn; each secretly presses Split or Steal (60 s); classic matrix: split/split both win, steal/steal both lose, steal/split the stealer wins. No prize, no persistence, no config.
- COMPLEXITY: small (~200–300 LOC). Pure core: pickTwoPlayers(rng) + resolve(a,b).

### wordlegame
- GAME: guess-the-word via typed channel messages; secret from words list (per language), guesses validated against a big dictionary (invalid = ❌ + no attempt used); each accepted guess re-renders the grid; ends on win/attempts/cancel/5-min idle. Stats per member (wins/games/guess distribution); no prize.
- OPTIONS: lang (17 languages, default en), length 4–11 (default 5), attempts 5–10 (default 6); per-member concurrency 1.
- PORT DECISIONS: replace Pillow with an emoji grid (🟩🟨⬛) or zero-dep SVG/PNG; ship EN lists only at first (words 7,543; dictionary 219,855 — trim to needed lengths); COPY the naive yellow rule exactly (no duplicate-letter counting); FIX the hardcoded-6 loss check to respect max_attempts (recorded deviation).
- COMPLEXITY: medium.

### memorygame
- GAME: single-player pairs on a button grid (3x3→4 pairs+center blank, 4x4→8 pairs, 5x5→12 pairs+center blank; emoji pool of 12); mismatch shows red 1 s then hides; win pays a decayed prize; optional loss cap via max_wrong_matches.
- PRIZE (exact): base = max_prize (5000) scaled 1/3 (3x3) or 2/3 (4x4); final = max(int((base − seconds·5 − wrong·15) · (n/5)), 0) — n = 3/4/5. Config: max_wrong_matches (default none), red_economy=false, max_prize=5000 (1000–50000), reduction_per_second=5 (0–30), reduction_per_wrong_match=15 (0–30). Member score/wins/games + leaderboard.
- KNOWN COG BUG: games double-counts on a loss — do NOT port; count once (recorded deviation).
- COMPLEXITY: small–medium (~400–600 LOC).

### city (CalaMari) — the crime RPG
- GAME: `/crime` menu → commit one of 5 crimes (pickpocket/mugging/rob_store/bank_heist/random-scenario) with success roll, 1–4 random flavour events modifying chance/reward/jail, streak bonus (+5%/success, cap +25%, 24 h expiry), fines, JAIL with bail (remaining minutes × 1.6) and one jailbreak per sentence (base 35%, fail +30% time), black market (3 items incl. −20% jail perk and a get-out-of-jail card), 6-category leaderboard, deep per-member stats.
- CRIME TABLE: pickpocket 150–500 @60% cd 10 m jail 1 h fine 0.35 steal 1–10%; mugging 400–1500 @60% cd 30 m jail 1.5 h fine 0.40 steal 15–25%; rob_store 500–2000 @50% cd 6 h jail 3 h fine 0.40; bank_heist 1500–5000 @40% cd 24 h jail 4 h fine 0.40; random = 46 scenarios (0.75/0.50/0.30 tiers). 96 crime events (24×4); event draw: 1st 100%, 2nd 75%, 3rd 50%, 4th 10%.
- COMPLEXITY: LARGE (13k+ lines incl. data). Slice order (from the survey): (1) non-targeted crimes + cooldowns + jail timer + status; (2) their 48 events + modifier pipeline; (3) jail/bail/jailbreak; (4) targeted crimes + target picker; (5) streaks; (6) random scenarios; (7) black market/inventory; (8) leaderboard + admin surface. Skip: crime/jail.py (dead WIP code), business module (design doc only).

---

## Survey C — connect4, hammertime, hangman, heist

### connect4 (phen-cogs)
- GAME: challenge → accept (60 s) → 7×6 emoji board in plain text, 7 digit buttons + cancel; turn colors; win = run ≥4 (rows/cols/diagonals); 120 s inactivity = forfeit; guild stats (played/ties/wins/losses/draws) + stats embed with top-3 medals.
- PORT NOTES: cog crashes on a full-column click (unhandled) — handle it; cog's tie-stat write uses the wrong key so ties never persist — FIX (recorded deviation); pieces ⚪🔴🔵.
- COMPLEXITY: small (~150 LOC pure logic + button plumbing).

### hammertime (Dumb-Cogs)
- FEATURE (not a game): per-user timezone registry; `ht <phrase>` parses natural time ("in 1 day and 12 hrs", "Saturday at 6:30pm", "now") in the USER'S zone and prints all 7 Discord <t:…> styles + codes; list mode groups every member's local time; optional auto-mode converts "at/in <digit>" messages into subtle timestamp replies.
- PORT NOTES: the whole job is replacing dateutil fuzzy parsing — hand-roll the relative parser (regex, cumulative, calendar-safe months) + a simplified absolute parser; timezone map via Intl.supportedValuesOf + timeZoneName:'short' for abbreviations. Reuse the birthdays timezone autocomplete (S44).
- COMPLEXITY: medium (parser fidelity is the risk).

### hangman (FlameCogs)
- GAME: single-player; ASCII gallows in a code block (7 frames — copy byte-for-byte), masked word, typed single-letter guesses (60 s/guess), 6 wrong = loss; repeat guesses free; non-letters auto-revealed; default edit-in-place + delete guess messages (doEdit toggle). Bundled words.txt (4,554 words). No economy, no stats.
- COMPLEXITY: small. Port: messageCreate collector; guild-owner config → our admin convention.

### heist (maxcogs)
- GAME: long-form idle crime economy — 25 heist types (30 s–25 min timers, cooldowns 10 min–10 h, vending_machine 10–80 up to space_agency 100k–200k / gold_reserve 3M–4M), success = randint(min,max)%+tool boost+level bonus; failure = loss (shield reduces, single-use) else DEBT +20% tax; independent police roll (police_chance + heat·2%, cap 90%) → jail + bail (max_loss × 0.5–1.0, +15% tax) + confiscation; heat decays 1/2 h idle; material drops → 28 craft recipes → enhanced tools/shields; ~75 items, levels 1–120 (cost floor(100n(1+0.12n)); success bonus +0.5%/level cap +20%); crew robbery at level 20+ (4 players, shared roll, split pot, per-member police rolls); owner-tunable tables; timers must survive restarts (persist end_time, re-arm on boot).
- COMPLEXITY: LARGE. Split: (a) data tables verbatim; (b) pure resolveHeist(state, settings, rng); (c) component views; (d) durable scheduler. Bank abstraction → our adjustBalance.

