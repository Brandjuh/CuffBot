# CuffBot 🚔

A police-themed Discord bot for running your server like a well-loved precinct: moderation as *citations* and *arrests*, a *rap sheet* for infractions, *dispatch* announcements, an *evidence locker* log channel, rank ladders from Cadet to Chief, and a little community fun (`/wanted`, `/donut`).

**Status:** all feature modules are live — 37 modules, 60 commands. **CuffBot is text-only (S68): every command is a `!command`**, and since S106 there are **no hyphenated command names** — a family is one command with subcommands (`!birthday set`, `!trivia scores`, `!patrol rule`), the way Red-DiscordBot does it. Every retired spelling still works as an alias, and **every** command is either a Red-style group (`!group sub <args>`) or a flat `!command` — the legacy path is gone as of S96 (M17 complete). Type `!help` for the full roster. Current truth lives in [`STATE.md`](STATE.md), the plan in [`ROADMAP.md`](ROADMAP.md).

CuffBot is a **one-precinct bot** by design: it serves exactly the guild set in [`config.json`](config.json) (`homeGuildId`) and automatically leaves any other server it is invited to.

## What CuffBot can do

| Area | Commands | Manual |
|---|---|---|
| **Core** 📻 | `!radiocheck`, `!help`, `!update`, `!restart` | [core](docs/modules/core.md) |
| **Rules** 📜 | `!rules` group — write the precinct's rules; the bot keeps one tidy post current by editing it in place | [rules](docs/modules/rules.md) |
| **Mafia** 🕵️ | `!mafia start` — Classic mafia for 5+: one Boss, one medic, one detective, and a lot of arguing | [mafia](docs/modules/mafia.md) |
| **Goals** 🎯 | `!goal` group — precinct targets with progress bars and milestone announcements, plus personal goals and a board | [goals](docs/modules/goals.md) |
| **Transcribe** 🎙️ | `!transcribe` group — voice memos and live voice chat written down, in English | [transcribe](docs/modules/transcribe.md) |
| **Kill Counter** 💀 | `!killcounter` group — go quiet after someone speaks and the last word scores; leaderboard included | [killcounter](docs/modules/killcounter.md) |
| **Selfroles** 🎭 | `!selfroles` group (button list: press to get a role, press again to remove) | [selfroles](docs/modules/selfroles.md) |
| **Hunting** 🦹 | `!hunting` group, `!hunting stats`, `!hunting board` — STOP POLICE crook hunt with the undercover officer | [hunting](docs/modules/hunting.md) |
| **Enforcement** 🚨 | `!cite` (animated ticket), `!fine` (fun), `!detain`, `!release`, `!arrest` | [enforcement](docs/modules/enforcement.md) |
| **Records** 📋 | `!rapsheet`, `!expunge` | [records](docs/modules/records.md) |
| **Dispatch** 🗄️ | `!dispatch locker`, `!dispatch` | [dispatch](docs/modules/dispatch.md) |
| **Academy** 🎖️ | `!promote`, `!demote`, `!ranks` (+ `setup`, `exclude`) | [academy](docs/modules/academy.md) |
| **Patrol** 👮 | `!patrol` (+ `rule`, `term`, `wizard`) — automod | [patrol](docs/modules/patrol.md) |
| **Public Affairs** 🍩 | `!badge`, `!wanted`, `!donut`, `!911` | [public-affairs](docs/modules/public-affairs.md) |
| **Leveling** 🎖️ | `!level`, `!leaderboard`, `!xp` group — message + voice XP, auto-rank | [leveling](docs/modules/leveling.md) |
| **Detective** 🕵️ | `!ask`, `!ai` group — talk to the bot (AI, or just @mention it) | [detective](docs/modules/detective.md) |
| **Birthdays** 🎂 | `!birthdays`, and the `!birthday` group (`set`, `remove`, + admin) | [birthdays](docs/modules/birthdays.md) |
| **Trivia** ❓ | `!trivia` (+ `scores`, `sets`) — buttoned quiz rounds | [trivia](docs/modules/trivia.md) |
| **Connect 4** 🔴 | `!connect4 @officer` or `!connect4 solo` — 7×6 button duels, against a member or the bot | [connect4](docs/modules/connect4.md) |
| **Hangman** 🪢 | `!hangman play` — solo word-guessing against the gallows | [hangman](docs/modules/hangman.md) |
| **Russian roulette** 🔫 | `!rr play` — last-officer-standing party game (mod opens the lobby) | [russianroulette](docs/modules/russianroulette.md) |
| **Split or Steal** 🤝 | `!sos play` — two random contestants, one secret trust dilemma | [splitorsteal](docs/modules/splitorsteal.md) |
| **Guess the Candy** 🍬 | `!gtc` — unscramble the candy, first right button wins on the clock | [guessthecandy](docs/modules/guessthecandy.md) |
| **Rollout** 🎲 | `!rollout play` — 50-player number-dodging elimination with a prize | [rollout](docs/modules/rollout.md) |
| **Memory** 🧠 | `!memory play` — find the emoji pairs; fast and precise pays best | [memory](docs/modules/memory.md) |
| **Wordle** 🟩 | `!wordle play` — type your guesses; 🟩🟨⬛ show how close you are | [wordle](docs/modules/wordle.md) |
| **Hammertime** ⏰ | `!ht in 2 hours` — timestamps that render right for every reader | [hammertime](docs/modules/hammertime.md) |
| **Heist** 💰 | `!heist bank` — timed jobs, gear, police heat, jail, bail and 4-officer crews | [heist](docs/modules/heist.md) |
| **City** 🌃 | `!crime bank` — pickpockets, muggings, 46 one-off jobs, bail, jailbreaks, a black market | [city](docs/modules/city.md) |
| **Memorial** 🕯️ | `!memorial` group — fallen firefighters/officers tracker (RSS, role tags) | [memorial](docs/modules/memorial.md) |
| **Starboard** ⭐ | `!starboard` group — ⭐-reactions repost highlights to the board | [starboard](docs/modules/starboard.md) |
| **Chat starter** 💬 | `!chatstarter` group — revive quiet channels with open questions | [chat-starter](docs/modules/chat-starter.md) |
| **Channel list** 🗂️ | `!channellist` group — self-updating directory of all categories & channels | [channellist](docs/modules/channellist.md) |
| **Economy** 💰 | `!donuts`, `!daily`, `!claims`, `!steal`, `!pot`, `!pot crack` + the `!economy`/`!claims` groups — donut balances, rations, heists | [economy](docs/modules/economy.md) |
| **Logbook** 📔 | `!logbook` group — log everything: messages, members, moderation, voice, server, invites | [logbook](docs/modules/logbook.md) |
| **Welcome** 👋 | `!welcome` group — greet every newcomer in the lobby | [welcome](docs/modules/welcome.md) |
| **YouTube** 📺 | `!youtube` group — announce creators' new uploads in a channel | [youtube](docs/modules/youtube.md) |

Enforcement actions flow into the rap sheet and the evidence locker automatically. The bot **self-updates** from `main` (test-gated) and is operated from a Raspberry Pi — see [operations](docs/README.md#operations).

## Quickstart

Prerequisites: Node.js ≥ 18 and a Discord account that can add bots to the home precinct.

1. **Create the application** — [Discord Developer Portal](https://discord.com/developers/applications) → *New Application* → name it **CuffBot**.
2. **Get the credentials:**
   - *General Information* → copy **Application ID** (this is `CLIENT_ID`).
   - *Bot* → *Reset Token* → copy the **token** (this is `DISCORD_TOKEN`). Treat it like a password.
3. **Configure the repo:**
   ```bash
   cp .env.example .env    # then paste DISCORD_TOKEN and CLIENT_ID into .env
   npm install
   ```
   The home precinct is already set in `config.json` → `homeGuildId`.
4. **Invite the bot to the home precinct** (replace `YOUR_CLIENT_ID`):
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=2048
   ```
   You need *Manage Server* in that guild to add it.
5. **Clear any stale slash commands** (CuffBot is text-only since S68 — this empties the guild's application-command roster):
   ```bash
   npm run deploy-commands
   ```
6. **Start the bot:**
   ```bash
   npm start
   ```
   The console should read `🚔 CuffBot on duty as <your bot tag>`. Try `/radio-check` in the server.

Something not working? Every module manual ends with a troubleshooting table — start with [`docs/modules/core.md`](docs/modules/core.md).

### Run it on a Raspberry Pi (recommended for 24/7)

One command — it installs Node, clones the repo, asks for your credentials, registers the commands, and sets up autostart via systemd:

```bash
git clone https://github.com/Brandjuh/CuffBot.git ~/CuffBot && bash ~/CuffBot/scripts/setup-pi.sh
```

Details, updating, and troubleshooting: [`docs/operations/raspberry-pi.md`](docs/operations/raspberry-pi.md).

## How this repo is built

CuffBot is developed session-by-session by Claude using a **self-improving build skill** in [`.claude/skills/run-skill-generator/`](.claude/skills/run-skill-generator/SKILL.md). Every session follows the same loop — orient on state, *verify it against reality*, build, document, record, and improve the skill itself — so sessions hand off seamlessly and the system gets sharper as the project grows.

- [`CLAUDE.md`](CLAUDE.md) — entry point that routes every session into the skill
- [`STATE.md`](STATE.md) — live snapshot + resume point (with a verification block)
- [`SESSION_LOG.md`](SESSION_LOG.md) — append-only journal of every session
- [`ROADMAP.md`](ROADMAP.md) — milestones with acceptance criteria
- [`docs/`](docs/README.md) — one manual per bot module (mandatory)

Everything in this repository — code, docs, commits — is written in English.

## Stack

Node.js ≥ 18 · discord.js v14 · ESM · `node:test` · atomic per-guild JSON storage (`src/core/store.js`, SQLite-ready seam) · zero runtime dependencies beyond discord.js (the citation renderer and GIF/PNG encoders are pure JS, so it runs anywhere). Rationale in [`architecture.md`](.claude/skills/run-skill-generator/references/architecture.md).
