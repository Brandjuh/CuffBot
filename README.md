# cuff-cogs

Custom Red-DiscordBot cogs for the **cuffbot** instance — ports of the Node.js
CuffBot modules (police theme, guild 411157175948541954). Each feature is its
own cog. All strings are English, faithful to the Node originals.

| Package | Cog | Commands | Ported from (Node) |
|---|---|---|---|
| `cufflevels` | CuffLevels | `$level`, `$levels`, `$xp …` | leveling + academy ladder |
| `cuffdetective` | CuffDetective | `$detective`, `$ai …`, @mention | detective (Groq AI) |
| `cufftranscribe` | CuffTranscribe | `$transcribe …` | transcribe (Whisper voice memos, audio files AND live voice) |
| `cuffstarboard` | CuffStarboard | `$starboard …` | starboard |
| `killcounter` | KillCounter | `$killcounter` / `$kills …` | killcounter |
| `cuffaffairs` | CuffAffairs | `$wanted`, `$badge`, `$donut`, `$911`, `$fine`, `$cite`, `$affairsset …` | publicaffairs + enforcement renderers |
| `crookhunt` | CrookHunt | `$hunting …` (replaces vrt hunting) | hunting (police theme) |
| `crackpot` | CrackPot | `$steal`, `$crackpot …`, `$crackpotset …` | economy steal + donut pot (steal rules extended, see Notes) |
| `cuffbirthday` | CuffBirthday | `$birthday …`, `$birthdays` (all replies are embeds; `$birthday embed on/off` for the announcement) | birthdays |
| `cuffhammertime` | CuffHammertime | `$hammertime …` / `$ht …` | hammertime |
| `cuffhelp` | CuffHelp | `$help` (panel), `$helpmenu …` | — (new) |
| `cuffunits` | CuffUnits | auto-convert, `$convert`, `$unitset …` | — (new) |
| `cufffirstmessage` | CuffFirstMessage | `$firstmessage` / `$firstmsg` / `$first`, `$firstmessageembed` | — (copy of Fox_V3 `firstmessage`, now with a clickable jump button) |
| `cuffsolo` | CuffSolo | `$solo bomb/fast/long/most/mix/splitsteal`, `$soloset …` | — (new) single-player versions of games that need a full channel |
| `cuffbank` | CuffBank | `$cuffbank`, `$cuffbank amount/backfill/on/off` | — (new) every member gets a bank account automatically |
| `cuffchatstarter` | CuffChatStarter | `$chatstarter …` / `$starter …` | chat-starter |
| `cuffselfroles` | CuffSelfRoles | `$selfroles …` / `$rolepanel …` | selfroles |
| `cuffchannellist` | CuffChannelList | `$channellist …` / `$clist …` | channellist |
| `cuffmemorial` | CuffMemorial | `$memorial …` (5 feeds: odmp, firehero, usfa, iaff, cpof) | memorial |
| `cuffrecords` | CuffRecords | `$rapsheet`, `$filerecord`, `$expunge`, `$archive` | records |
| `cuffembed` | CuffEmbed | `!cuffembed …` | — (new) posts the STOCK cogs' plain-text messages as embeds |
| `cuffminigames` | CuffMinigames | `$connect4` / `$c4`, `$tictactoe` / `$ttt`, `$minigamesset …` | — (fork of crab-cogs `minigames`, replaces it) |
| `cuffidwatch` | CuffIdWatch | `$idwatch ping/dm/on/off`, `$idwatchset list/user` | — (new) ping/DM you when your raw user ID is used |
| `cuffsay` | CuffSay | `$say <text>` (mod/admin) | — (new) bot repeats it anonymously, invoking message deleted |

> **Prefix note (2026-07-29, done):** the prefixes were SWAPPED — the Node bot
> took `$` and Red now runs on `!` (verified in `core/settings.json`). Read every
> `$command` below as `!command` (e.g. `!xp migratecuff`).

## Deployment (in Discord, as bot owner)

```
$addpath /home/brand/cuff-cogs
$unload hunting                       ← vrt bird hunt out first ($hunting name clash)
$load crackpot
$load crookhunt cufflevels cuffdetective cufftranscribe cuffstarboard killcounter cuffaffairs
$load cuffbirthday cuffhammertime cuffhelp cuffunits
$unload firstmessage                  ← Fox_V3 copy out first ($firstmessage name clash)
$load cufffirstmessage cuffsolo cuffbank cuffchatstarter
$load cuffselfroles cuffchannellist cuffmemorial cuffrecords
$load cuffembed                       ← stock cogs answer in embeds from here on
$unload minigames                     ← crab-cogs original out first ($c4/$ttt name clash)
$load cuffminigames
```

> **Name note:** Red's core `admin` cog owns `$selfrole` (singular) — its own
> unrelated opt-in role list, curated with `$selfroleset add`. `cuffselfroles`
> is therefore `$selfroles` (plural), aliased `$rolepanel` / `$roleboard`;
> claiming the singular as an alias stops the cog loading. If having both
> confuses members, hide Red's with `$command disable server selfrole`.

Give everyone an account with 10 000 donuts to start (existing members and all
future ones), without taking anything off the people who already earned more:

```
$cuffbank amount 10000            ← new accounts open at 10 000
$cuffbank backfill 10000          ← everyone here now holds at least 10 000
```

Migrate live settings + data from the Node bot (per cog; `preview` first to dry-run):

```
$xp migratecuff preview          → $xp migratecuff
$ai migratecuff preview          → $ai migratecuff        (also imports the Groq key from /home/brand/CuffBot/.env)
$transcribe migratecuff preview  → $transcribe migratecuff
$starboard migratecuff preview   → $starboard migratecuff
$killcounter migratecuff preview → $killcounter migratecuff
$hunting migratecuff preview     → $hunting migratecuff
$crackpotset migratecuff preview → $crackpotset migratecuff
$affairsset migratecuff preview  → $affairsset migratecuff
$birthday migratecuff preview    → $birthday migratecuff   (4 birthdays in the Node file)
$ht migratecuff preview          → $ht migratecuff         (3 timezones in the Node file)
$selfroles migratecuff preview   → $selfroles migratecuff   (3 role info texts)
$channellist migratecuff preview → $channellist migratecuff
$memorial migratecuff preview    → $memorial migratecuff    (carries the seen-entry history)
$chatstarter migratecuff preview → $chatstarter migratecuff
```

Two of those need a follow-up, because a posted message belongs to the bot that
posted it: the Node bot's self-roles buttons and channel list cannot be adopted
by Red. Run `$selfroles post` and `$channellist post` for working copies, then
delete the Node bot's originals by hand.

If the key import is skipped or fails: `$set api groq api_key,<key>` (key is in
`/home/brand/CuffBot/.env`). One `groq` service feeds both the detective and
Whisper transcription, with separate rate budgets.

Then disable the Node counterparts so nothing runs double
(`!xp off`, `!ai off`, `!starboard off`, `!killcounter off`, `!hunting off`,
`!economy off`), and once everything is verified:
`sudo systemctl disable --now cuffbot.service`.

## Smoke checklist

- `$level`, `$levels`, `$xp ladder` (25 ranks, thresholds 1000 → 328 316)
- `$detective test` in the AI channel; @mention the bot; ask twice fast (7 s cooldown → desk pile)
- send a voice memo (auto-transcribes); `$transcribe now` on a reply;
  `$transcribe join` in a VC → speak → transcript lines in the paired channel
- react with the custom star emoji ×5 → Commendation Board post
- stay silent 1 h in the kill-counter channel → 💀 kill
- `$wanted @member`, `$fine @member <reason>`, `$badge`, `$donut`
- `$hunting spawn` → shout `STOP POLICE` (salute the 🕵️!)
- `$steal @member`, `$crackpot`, `$crackpot crack`
- `$birthday set 1990/05/23` → `$birthdays` lists you; `$birthday forcesweep`
  announces immediately if today is the day (`$birthday` shows every setting)
- `$ht tz amsterdam` → `$ht in 2 hours` (seven styles); `$ht tz est` opens the
  picker; `$ht 5pm list` groups everyone west → east; `$ht auto on`, then type
  "let's meet at 5"
- `$c4` (no opponent) → play it out: the entry leaves your balance, the winning
  four turn into squares with a line naming the direction, and the pot lands
  where it should — `$crackpot` after losing one shows it went up
- `$memorial test` in a private channel → one embed per feed, exactly as the
  tracker would post it: the fallen hero's name (odmp.org hides it in the
  profile slug — its `<title>` is the agency), their story, their photo. It
  pings nobody and marks nothing as seen, so the real sweep still honours those
  entries. `$memorial test odmp 3` for the last three officers; `$memorial
  preview` fetches without posting anything at all.
- Five feeds, all posting in <#451095508560379934>: `odmp` (Fallen Officers),
  `firehero` (Fallen Firefighters), `usfa` (FEMA firefighter fatality notices),
  `iaff` (union line-of-duty deaths) and `cpof` (correctional officers). The
  ping role follows the **kind of service**, not the feed, so the three
  firefighter feeds share one: police `627946543273738240`, firefighter
  `627946690024046675`, correctional `1533202959624830976`. Move or re-aim any
  single feed with `$memorial feedchannel <id> #chan` /
  `$memorial feedrole <id> @role`.
  Photos: odmp and cpof have them (cpof's are lifted off the article page, one
  page at a time — their site 429s a burst, so a `backfill cpof 5` takes a
  couple of minutes and the odd entry ends up without one). **usfa and iaff
  publish no photograph anywhere** — not in the feed, not in USFA's API, not on
  either page. For usfa that gap is filled with the fatality record behind the
  notice (`/api/fatalityDatums/<id>`): the account of what happened, the
  department, age and years of service. iaff gives a name and a local, and that
  is all it has.
- Long accounts are cut at 700 characters and every embed closes with a link
  line in the source's own words — `Read their full memorial →`,
  `Read the full tribute →`, `View their line-of-duty-death profile →`. The
  title links there too, but a story that stops mid-sentence should say where
  the rest of it is. Set per feed with `link_text`.
- Two of those sources push back, and the cog is shaped around it:
  `cpof.org`'s WAF answers **429 to any user agent that is not Mozilla-shaped**
  regardless of rate, so the agent is `Mozilla/5.0 (compatible; CuffBot/1.0;
  +url) memorial-feed-reader` — self-identifying, but in the shape they accept.
  `iaff.org` is behind Cloudflare, which refuses aiohttp on its TLS
  fingerprint (403 for every header combination) while `curl` on the same
  machine and IP gets 200 — so that one feed is read with curl
  (`"fetch_via": "curl"`, fixed argv, no shell).
- `$memorial backfill` then fills the **real** channel with the last 5 per feed,
  oldest first and **without pinging** — for a channel that was baselined empty
  and has nobody on it yet. It deliberately posts entries that are already
  marked *seen*: baselining marks them seen without ever posting them, and
  those are exactly the ones a backfill is for. What it skips instead is
  entries the bot has really placed before (tracked separately, in `posted`),
  so a second run does not give anyone two memorials. If a feed had never been
  baselined at all, the rest of its backlog is marked seen too, so the next
  sweep cannot dump history *with* pings. `$memorial backfill odmp 3` for one
  feed, max 10. Logic is covered by `tests/test_memorial.py`
  (`~/cuffenv/bin/python tests/test_memorial.py`).
- `!payday` and `!freecredits all` come back as embeds; `!cuffembed preview`
  renders all five sample messages without waiting out a cooldown, and
  `!cuffembed` shows which cogs are covered

## Port status — what the Node bot still had that Red does not

The Node bot (`cuffbot.service`) was stopped and disabled on 2026-07-30. These
are its 37 modules and where each one ended up.

**Covered by a cuff-cog** — birthdays, chat-starter, detective, enforcement +
public-affairs + dispatch logging, hammertime, hunting, killcounter, leveling +
academy, minigames, starboard, transcribe, the economy's steal/pot half, and the
core help panel.

**Covered by the third-party cog the Node module was itself a port of** — city,
hangman, heist, mafia, splitorsteal, wordle, trivia, welcome
(`gptwelcome`/`joinmessage`), youtube (Red's `streams` speaks YouTube), and the
economy's daily/claims half (Red `economy` + `payday` + `cuffbank`).

**Already in a downloaded repo, just not installed** — one command each:

```
$cog install AAA3A-cogs guessthecandygame memorygame rolloutgame russianroulettegame
```

**Not ported, no equivalent — these features are still gone:**

| Node module | What is missing |
|---|---|
| `goals` | Precinct-wide targets with progress bars and milestone announcements |
| `logbook` | Full server event log (messages, members, voice, server structure). Red's `modlog` only covers moderation actions |
| `patrol` | Automod: banned terms, invite links, spam. Red's `filter` does word filtering only — no invite or spam rules |
| `rules` | Numbered rulebook kept as one tidy published post |

`core`'s odds and ends (`!radiocheck`, `!maintenance`, `!restart`) are roughly
Red's own `[p]ping` and `[p]restart`.

## Solo play (`cuffsolo`)

Which games already work with one human, and which needed help:

| Game | Solo? | How |
|---|---|---|
| Connect 4, Tic-Tac-Toe (`cuffminigames`) | ✅ already | `$c4` / `$ttt` with no opponent plays the bot — and the bot pays its own entry, so it is a real pot |
| Battleship | ✅ already | "Play vs AI" button in the join view |
| Monopoly | ✅ already | AI players can fill the seats |
| Hangman, Wordle | ✅ already | single-player by nature |
| Party word games | ➕ `cuffsolo` | `$solo bomb/fast/long/most/mix` vs precinct officers |
| Split or Steal | ➕ `cuffsolo` | `$solo splitsteal` vs a bot with a hidden strategy |
| Mafia | ❌ | see below |

Three difficulties (`rookie`, `officer`, `detective`) and 1–4 opponents:
`$soloset difficulty detective`, `$soloset opponents 3`, or pass one per game
(`$solo fast 5 detective`). The 3-letter prompts are derived from the bundled
dictionary, so every prompt has at least 30 valid answers — no unsolvable
rounds. `$soloset payout` is **0 by default on purpose**: a game one person can
replay on demand is a money printer.

**Mafia is deliberately not included.** It is a 12k-line social-deduction game
whose entire content is reading other humans. Bots that follow a script are not
something you can read, so a solo Mafia is a crossword with the answers printed
underneath — a lot of work for a game that stops being the game.

## Notes

- Balances live in Red's own bank (currency: donut). Node balances are NOT
  migrated; the pot (16 448 🍩 at port time) is.
- Live voice transcription works via `pynacl` + `discord-ext-voice-recv`
  (installed in the venv). One voice connection per guild: live listening
  and Audio (music) playback are mutually exclusive — the cog refuses to
  join while the DJ booth is occupied, and vice versa.
- `extendedeconomy` hooks all bank events; `$addcost` also applies to `$steal`
  and `$crackpot crack` — feature, not a bug.
- `$steal` (owner request 2026-07-29): the haul is a random **5–500 🍩** instead
  of a flat 500, and there are now three outcomes — **30 %** you get away with
  it, **5 %** the mark catches you and robs YOU (donuts go to them, not the
  pot), **65 %** plain bust into the pot. Success odds are unchanged; the
  backfire band was carved out of the busts. Two new limits: a victim can only
  be robbed **once per UTC day**, and after being robbed they may not hit their
  thief back for **12 h**. Both are checked before the thief's 3 h cooldown is
  stamped, so a refusal costs nothing. Knobs: `$crackpotset stealrange 5 500`,
  `backfirechance`, `revengelock`, plus the existing `stealchance` /
  `stealcooldown`. The old `heist_amount` setting is gone (`stealamount` still
  works as an alias for `stealrange`).
- Don't re-load the vrt `hunting` cog while `crookhunt` is loaded (same
  `$hunting` command); consider `$cog uninstall hunting` later.
- `cuffminigames` (owner request 2026-07-30) is a **fork of crab-cogs
  `minigames`**, not a patch of it: the original lives under Downloader, and
  `$cog update` would put it back the way it was without saying so. Same games,
  same opponent, precinct money rules:
  **every seat pays a fixed entry of 100 🍩 — the bot included — and the winner
  takes the whole 200 🍩 pot. A pot the player does not win goes into the crack
  pot**, like every other lost donut here. A tie returns both entries; a game
  cancelled before a move does too; a live game replaced by a stranger pools its
  pot rather than deleting it. What the original did instead: it charged the two
  humans in a PvP game and paid the winner double, but against the bot it
  charged the human *nothing* and paid a flat prize on a win.
  ⚠️ **The bot's entry is minted by the house** (owner's choice when asked), so
  beating me is worth a net +100 🍩. `$minigamesset botentry false` turns that
  off — bot games then break even instead. `$minigamesset entry <n>` sets the
  fee (0 = free, nothing paid out); `$minigamesset` alone shows the lot.
  Connect 4 also **shows which line won** now: the four pieces become 🟥/🟦
  squares, the column header stays on screen, and a caption names the direction
  and the columns (`🏆 Winning line: ↗️ diagonal — 1️⃣2️⃣3️⃣4️⃣`). Tic-Tac-Toe
  turns the winning three green. Upstream drew a finished board exactly like a
  running one. Logic is covered by `tests/test_cuffminigames.py`
  (`~/cuffenv/bin/python tests/test_cuffminigames.py`).
- `cuffbirthday` makes every Node "owner decision" a setting: channel, role,
  gift amount, default timezone, announcement text, ping, and the sweep
  cadence. The defaults are the Node values, so a plain `$load` behaves the
  same. The gift pays into Red's bank instead of the Node economy.
- `cuffhammertime` resolves US shorthand to ONE zone, no picker: `est`/`edt`/
  `et`/`eastern` → America/New_York, and the same for central/mountain/pacific/
  alaska/hawaii/arizona (plus `gmt`/`uk` → Europe/London). The abbreviation
  technically matches 35 zones (`est`) or 44 (`cst`), most of them Caribbean
  and Mexican zones with different DST rules — an unusable list for the US
  members. The table is `CANONICAL_ALIASES` in `cuffhammertime/zones.py`; add
  a line to extend it. `$ht zones` shows the list in Discord.
- `cuffhammertime` indexes timezone abbreviations for BOTH halves of the year,
  which fixes a regression from the Node port: on `Intl` only the *current*
  abbreviation existed, so in July `est` never found `America/New_York`. In
  Python the tz database is back, so `est` and `edt` both find it year-round.
- `cuffhelp` **replaces Red's help formatter** — never load a second cog that
  does the same. It only takes over bare `$help`; `$help <command>` and
  `$help <cog>` still go through Red's own formatter, so signatures, aliases,
  fuzzy "command not found" and every `$helpset` option are unchanged. It falls
  back to Red's menu automatically where embeds are disabled, and
  `$helpmenu off` reverts without unloading. `$unload cuffhelp` restores the
  formatter too. All 70 currently loaded cogs map to a category; check with
  `$helpmenu uncategorised` after installing anything new, and move one with
  `$helpmenu setcategory <cog> <category>`. The default map is
  `DEFAULT_CATEGORIES` in `cuffhelp/categories.py`.
- 🔧 **Admin** is a category filled by command NAME, not by cog: anything
  matching Red's `<thing>set` convention (`triviaset`, `heistset`,
  `crackpotset`, `audioset`, `economyset`, …) plus `*config` / `*settings` and
  a short hand-listed set (`set`, `starboard`, `ai`, `helpmenu`) is pulled out
  of its feature category and shown there. Mixed groups stay put on purpose —
  `birthday`, `ht` and `transcribe` hold member commands too, so they remain in
  Community/Utility where members can find them. Because the panel filters per
  viewer, ordinary members never see the Admin button at all. Inspect with
  `$helpmenu admincommands`; adjust with `$helpmenu adminadd/adminremove
  <command>` or `$helpmenu setcommand <command> <category>`.
- `cuffunits` watches chat and posts a metric ⇄ imperial embed. Five families
  (temperature, speed, volume, distance, mass), each switchable with
  `$unitset family <name> on|off`. **Detection is deliberately narrow**, because
  a bot that answers "see you at 10 in the morning" with "10 in = 25.4 cm" gets
  muted immediately: bare `m`, `g` and `in` are NOT units, single letters
  (`72f`, `5l`, `20c`) only count when glued to the number, and code blocks,
  URLs, mentions and `<t:…>` timestamps are skipped. It also stays silent when
  the author already gave both figures — matched on the VALUE, since "22C"
  never contains the word "celsius". Defaults: US gallon (`$unitset gallon
  imperial` to switch — a 20 % difference), 15 s cooldown per channel, max 4
  conversions per message. Preview any phrase with `$unitset test <text>`
  without posting. Times are out of scope on purpose — that is Hammertime's job.
- Dutch spellings are recognised alongside the English ones: `km/u`, `kmu`,
  `kilometer per uur`, `22 graden`, `22 graden C`, `72 graden fahrenheit`.
  Bare `graden` counts as Celsius, which is right for "het is 22 graden" and
  wrong for "een hoek van 90 graden" — deliberate, and one line in
  `cuffunits/units.py` to remove if it ever becomes a nuisance.
- A `Birthday` cog data folder from an older third-party cog exists in the Red
  data dir. That cog is not loaded; don't load it alongside `cuffbirthday` —
  the `$birthday` command would clash.
- `cuffembed` (owner request 2026-07-30: *"plaats berichten zoals payday ook in
  een embed"*) makes the STOCK cogs match the cuff-cogs. Red's `economy`
  (`!payday`, `!balance`, `!bank`) and YamiCogs' `payday` (`!freecredits …`)
  send bare strings, and they are upstream files — editing them there is undone
  by the next cog update. So instead of forking anything, this cog wraps the two
  send paths every cog goes through (`Context.send` for replies,
  `Messageable.send` for messages no command asked for) and re-renders the text
  as an embed on the way out. Recognised messages get a title and colour (💰
  Payday, ⏳ Not yet, 🏦 Balance, 🚫 No can do); everything else becomes a plain
  precinct-gold box. **Covered by default:** `economy`, `payday`, `cashdrop`,
  `extendedeconomy`, `heist`, `city`, `simplecasino` — widen with
  `!cuffembed add <cog>`, and every other cog on the bot is untouched.
  Deliberately skipped, so nothing that already looks right is mangled: replies
  that already carry an embed, interactive menus and paginators (`view=`), polls,
  link-only messages (an embed would eat the link preview), and anything longer
  than an embed description holds. **Pings are off** (a mention inside an embed
  renders but never pings, like the precinct's other announcements) —
  `!cuffembed ping on` lifts the leading mention out and sends it alongside the
  embed. Because the hook is bot-wide, the switches are bot-owner-only and the
  decision path is wrapped: any error in it falls back to sending the original
  plain text. `!cuffembed off` stops the rewriting, `!unload cuffembed` removes
  the hook entirely. Because that hook is the one piece of code here that can
  affect every message the bot sends, it is the one with tests:
  `~/cuffenv/bin/python tests/test_wrap.py` (the decisions, the rules, the patch)
  and `tests/test_cog.py` (the real cog on real Config, in a throwaway data dir)
  — 64 checks, no bot or network needed.
