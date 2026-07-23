# CuffBot 🚔

A police-themed Discord bot for running your server like a well-loved precinct: moderation as *citations* and *arrests*, a *rap sheet* for infractions, *dispatch* announcements, an *evidence locker* log channel, rank ladders from Cadet to Chief, and a little community fun (`/wanted`, `/donut`).

**Status:** the bot core (M1) is live — `/radio-check` plus single-precinct jurisdiction enforcement. Current truth lives in [`STATE.md`](STATE.md), the plan in [`ROADMAP.md`](ROADMAP.md).

CuffBot is a **one-precinct bot** by design: it serves exactly the guild set in [`config.json`](config.json) (`homeGuildId`) and automatically leaves any other server it is invited to.

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
5. **Register the slash commands** (guild-scoped, instant):
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

Node.js ≥ 18 · discord.js v14 · ESM · `node:test` · JSON storage (SQLite-ready seam, arrives with M3). Rationale in [`architecture.md`](.claude/skills/run-skill-generator/references/architecture.md).
