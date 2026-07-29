# cuff-cogs

Custom Red-DiscordBot cogs for the **cuffbot** instance — ports of the Node.js
CuffBot modules (police theme, guild 411157175948541954). Each feature is its
own cog. All strings are English, faithful to the Node originals.

| Package | Cog | Commands | Ported from (Node) |
|---|---|---|---|
| `cufflevels` | CuffLevels | `$level`, `$levels`, `$xp …` | leveling + academy ladder |
| `cuffdetective` | CuffDetective | `$detective`, `$ai …`, @mention | detective (Groq AI) |
| `cufftranscribe` | CuffTranscribe | `$transcribe …` | transcribe (Whisper; no live voice on Red) |
| `cuffstarboard` | CuffStarboard | `$starboard …` | starboard |
| `killcounter` | KillCounter | `$killcounter` / `$kills …` | killcounter |
| `cuffaffairs` | CuffAffairs | `$wanted`, `$badge`, `$donut`, `$911`, `$fine`, `$cite`, `$affairsset …` | publicaffairs + enforcement renderers |
| `crookhunt` | CrookHunt | `$hunting …` (replaces vrt hunting) | hunting (police theme) |
| `crackpot` | CrackPot | `$steal`, `$crackpot …`, `$crackpotset …` | economy steal + donut pot |

> **Prefix note (2026-07-29):** the prefixes were SWAPPED — the Node bot now
> uses `$` and Red is moving to `!`. Once Red runs on `!`, read every `$command`
> below as `!command` (e.g. `!xp migratecuff`). The Node counterparts to
> disable are then `$xp off`, `$ai off`, etc.

## Deployment (in Discord, as bot owner)

```
$addpath /home/brand/cuff-cogs
$unload hunting                       ← vrt bird hunt out first ($hunting name clash)
$load crackpot
$load crookhunt cufflevels cuffdetective cufftranscribe cuffstarboard killcounter cuffaffairs
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
```

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
- send a voice memo (auto-transcribes); `$transcribe now` on a reply
- react with the custom star emoji ×5 → Commendation Board post
- stay silent 1 h in the kill-counter channel → 💀 kill
- `$wanted @member`, `$fine @member <reason>`, `$badge`, `$donut`
- `$hunting spawn` → shout `STOP POLICE` (salute the 🕵️!)
- `$steal @member`, `$crackpot`, `$crackpot crack`

## Notes

- Balances live in Red's own bank (currency: donut). Node balances are NOT
  migrated; the pot (16 448 🍩 at port time) is.
- Live voice transcription is deliberately out of scope: discord.py cannot
  receive voice and Lavalink (Audio cog) owns the voice connection.
- `extendedeconomy` hooks all bank events; `$addcost` also applies to `$steal`
  and `$crackpot crack` — feature, not a bug.
- Don't re-load the vrt `hunting` cog while `crookhunt` is loaded (same
  `$hunting` command); consider `$cog uninstall hunting` later.
