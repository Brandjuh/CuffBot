# CuffBot — Module Manuals

One manual per bot module, all following the same template (`.claude/skills/run-skill-generator/references/module-manual-template.md`) so you always know where to look. A module without a current manual is unfinished work — if you find code here that this index does not cover, treat it as a bug and log it.

| Module | Manual | Status |
|---|---|---|
| city | [`modules/city.md`](modules/city.md) | stable (S92) |
| core | [`modules/core.md`](modules/core.md) | stable (S1) |
| enforcement | [`modules/enforcement.md`](modules/enforcement.md) | stable (S7) |
| guessthecandy | [`modules/guessthecandy.md`](modules/guessthecandy.md) | stable (S80) |
| hammertime | [`modules/hammertime.md`](modules/hammertime.md) | stable (S84) |
| heist | [`modules/heist.md`](modules/heist.md) | stable (S88) |
| hangman | [`modules/hangman.md`](modules/hangman.md) | stable (S72) |
| memory | [`modules/memory.md`](modules/memory.md) | stable (S82) |
| records | [`modules/records.md`](modules/records.md) | stable (S8) |
| rollout | [`modules/rollout.md`](modules/rollout.md) | stable (S81) |
| wordle | [`modules/wordle.md`](modules/wordle.md) | stable (S83) |
| russianroulette | [`modules/russianroulette.md`](modules/russianroulette.md) | stable (S73) |
| dispatch | [`modules/dispatch.md`](modules/dispatch.md) | stable (S11) |
| academy | [`modules/academy.md`](modules/academy.md) | stable (S12) |
| patrol | [`modules/patrol.md`](modules/patrol.md) | stable (S13) |
| public-affairs | [`modules/public-affairs.md`](modules/public-affairs.md) | stable (S14) |
| leveling | [`modules/leveling.md`](modules/leveling.md) | stable (S16) |
| detective | [`modules/detective.md`](modules/detective.md) | stable (S17) |
| birthdays | [`modules/birthdays.md`](modules/birthdays.md) | stable (S19) |
| trivia | [`modules/trivia.md`](modules/trivia.md) | stable (S20) |
| memorial | [`modules/memorial.md`](modules/memorial.md) | stable (S21) |
| starboard | [`modules/starboard.md`](modules/starboard.md) | stable (S22) |
| channellist | [`modules/channellist.md`](modules/channellist.md) | stable (S36) |
| chat-starter | [`modules/chat-starter.md`](modules/chat-starter.md) | stable (S23) |
| minigames | [`modules/minigames.md`](modules/minigames.md) | Connect 4 on a panel — challenge an officer or the bot, played on one message the bot edits in place |
| logbook | [`modules/logbook.md`](modules/logbook.md) | stable (S35) |
| welcome | [`modules/welcome.md`](modules/welcome.md) | stable (S35) |
| economy | [`modules/economy.md`](modules/economy.md) | stable (S38) |
| youtube | [`modules/youtube.md`](modules/youtube.md) | stable (S52) |
| selfroles | [`modules/selfroles.md`](modules/selfroles.md) | stable (S59) |
| rules | [`modules/rules.md`](modules/rules.md) | stable (S97) |
| killcounter | [`modules/killcounter.md`](modules/killcounter.md) | stable (S99) |
| transcribe | [`modules/transcribe.md`](modules/transcribe.md) | stable (S101, live voice S102) |
| goals | [`modules/goals.md`](modules/goals.md) | stable (S103) |
| mafia | [`modules/mafia.md`](modules/mafia.md) | stable (S105, Classic mode) |
| splitorsteal | [`modules/splitorsteal.md`](modules/splitorsteal.md) | stable (S79) |
| hunting | [`modules/hunting.md`](modules/hunting.md) | stable (S66) |

## Operations

| Guide | Covers |
|---|---|
| [`operations/raspberry-pi.md`](operations/raspberry-pi.md) | Install, run, self-update, the Message Content intent, day-to-day commands |
| [`operations/backup-and-recovery.md`](operations/backup-and-recovery.md) | Backing up `data/`, restoring, token rotation, moving to a new Pi |

## Porting references

Written when a game was ported from an existing Red cog, and kept because the session workspace that held the source is ephemeral.

| Document | Covers |
|---|---|
| [`porting/S65-cog-surveys.md`](porting/S65-cog-surveys.md) | The 14-cog intake survey (S65): game flow, commands, config defaults and exact mechanics per source cog |
| [`porting/S115-game-interaction-audit.md`](porting/S115-game-interaction-audit.md) | How each game is *played*, ours vs. its source (S115/M26.1) — which ports kept the source's panels and which rebuilt it as commands |

## Reading order for newcomers

1. Root [`README.md`](../README.md) — what CuffBot is and how to run it.
2. [`ROADMAP.md`](../ROADMAP.md) — where it is going.
3. The manual of whichever module you are touching.
