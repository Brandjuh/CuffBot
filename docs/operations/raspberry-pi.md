# Running CuffBot on a Raspberry Pi

> Operations runbook. The setup script does everything below automatically; this page explains what it does, what you need beforehand, and how to operate the bot afterwards.

**Last updated:** Session 2 · 2026-07-23

## Requirements

- Raspberry Pi **2 or newer** (Pi 1/Zero are armv6 — Node.js ≥ 18 has no builds for them). 64-bit Raspberry Pi OS recommended.
- Internet access on the Pi.
- The repository is **private**, so cloning needs your GitHub login once: username = your GitHub name, password = a **Personal Access Token** (github.com → Settings → Developer settings → *Fine-grained tokens* → access to `Brandjuh/CuffBot`, Contents: read). Git caches it if you enable `git config --global credential.helper store` (plain-text on disk — your call).
- Your Discord credentials: `DISCORD_TOKEN` (Developer Portal → Bot → Reset Token) and `CLIENT_ID` (→ General Information).

## The one command

```bash
git clone https://github.com/Brandjuh/CuffBot.git ~/CuffBot && bash ~/CuffBot/scripts/setup-pi.sh
```

While the pull request for the current work is not merged to `main` yet, pin the branch:

```bash
git clone -b claude/self-improving-skill-generator-uelf8q https://github.com/Brandjuh/CuffBot.git ~/CuffBot && bash ~/CuffBot/scripts/setup-pi.sh
```

The script is **safe to re-run** (also the way to update the bot later): it pulls the latest code, keeps your `.env`, re-registers commands, and restarts the service.

## What the script does

1. `apt` installs `git`, `curl`, `ca-certificates`.
2. Installs **Node.js 22 LTS** via NodeSource — skipped when Node ≥ 18 is already present. Aborts with a clear message on armv6.
3. Clones the repo to `~/CuffBot` (or updates the existing clone; when you run it from inside a clone, that clone is used).
4. `npm install`.
5. Asks for `DISCORD_TOKEN` (hidden input) and `CLIENT_ID`, writes `.env` with mode 600. An existing `.env` is never overwritten.
6. Runs `npm test`, then registers the slash commands guild-scoped in the home precinct (`config.json → homeGuildId`).
7. Optionally installs a **systemd service** (`cuffbot`) that starts the bot at boot and restarts it on crashes, then starts it.

Overrides: `CUFFBOT_DIR` (install directory), `CUFFBOT_BRANCH` (branch to check out).

## Self-update (armed by setup step 8)

A systemd timer (`cuffbot-update.timer`) runs `scripts/update.sh` every 15 minutes: fetch → if new commits: fast-forward, `npm install`, **run the test suite** → only a green suite gets its commands re-registered and the service restarted. A red suite is rolled back and the old bot keeps serving — unattended updates never trade uptime for freshness. Requirements: stored git credentials (the setup step arranges this) — that is also why the setup does one interactive fetch.

| Task | Command |
|---|---|
| Update history / last run | `journalctl -u cuffbot-update` |
| Force an update check now | `sudo systemctl start cuffbot-update.service`, or `/update` in Discord (admins) |
| Pause / resume auto-update | `sudo systemctl disable --now cuffbot-update.timer` / `… enable --now …` |

Step 8 also installs a scoped `sudoers` drop-in (`/etc/sudoers.d/cuffbot`) allowing exactly `systemctl restart cuffbot` and `systemctl start cuffbot-update.service` without a password, so both the timer and the in-Discord `/update` can restart cleanly.

## Text commands (`!`) and the Message Content intent

Every command also works as `!command` (e.g. `!help`, `!cite @user spam`). This needs the **Message Content intent**, which is privileged: enable it at Developer Portal → your app → Bot → Privileged Gateway Intents → **Message Content Intent**. If it is off, the bot still runs — slash commands work, `!` commands and patrol are disabled, and the startup log says so. Restart after enabling: `sudo systemctl restart cuffbot`. XP/leveling is unaffected either way: message XP needs only the message *event* (not its content) and voice XP uses the non-privileged voice-states intent, so both keep working even without Message Content.

## Day-to-day operation

| Task | Command |
|---|---|
| Live logs | `journalctl -u cuffbot -f` |
| Status | `systemctl status cuffbot` |
| Restart | `sudo systemctl restart cuffbot` |
| Stop / disable autostart | `sudo systemctl stop cuffbot` / `sudo systemctl disable cuffbot` |
| Update immediately (manual) | `bash ~/CuffBot/scripts/update.sh` (or re-run the setup script) |
| Rotate the token | See [`backup-and-recovery.md`](backup-and-recovery.md) → Rotating the bot token |
| Back up member data | See [`backup-and-recovery.md`](backup-and-recovery.md) — `data/` is the only Pi-only state |

## Troubleshooting

**Start here for almost everything:** `cd ~/CuffBot && npm run doctor`. Since S18 the doctor checks the whole chain — credentials against Discord, whether the checkout is behind GitHub (self-updater stalled), whether every command in the code is actually registered in Discord (it lists exactly which are missing), whether the bot service is running, and whether the update timer is armed — and prints the exact fix command for each ❌.

| Symptom | Likely cause | Fix |
|---|---|---|
| **A command is missing in Discord** (e.g. a new `/x` never appears) | Registration failed during self-update, or the updater never ran | `npm run doctor` → follow its arrow; usually `node src/deploy-commands.js`. Since S18 the updater logs registration failures loudly: `journalctl -u cuffbot-update -n 30` |
| **Every command errors / "application did not respond"** | Bot process down or crash-looping | `npm run doctor` (Services section) → `journalctl -u cuffbot -n 30` names the crash |
| **New features never arrive on the Pi** | Update timer not armed, or git fetch failing (credentials) | `npm run doctor` (Update chain + Services) → re-run `bash scripts/setup-pi.sh` to arm the timer |
| Anything credential-related | — | `npm run doctor` — verifies your `.env` and token **against Discord itself** and names the exact problem |
| `git clone` asks for a password and rejects your GitHub password | Repo is private; git needs a token, not your password | Create the Personal Access Token described above and paste it as the password |
| Script aborts: "armv6 … no builds" | Pi 1 / Pi Zero | Use a Pi 2 or newer |
| "Command registration failed" | Token or client id wrong in `.env` | Fix `~/CuffBot/.env`, re-run the script |
| Service runs but bot is offline in Discord | Wrong token, or bot not invited to the precinct | `journalctl -u cuffbot -n 50`; check the invite step in README → Quickstart |
| Bot immediately leaves your server | That guild is not the home precinct — by design | Set the right id in `config.json → homeGuildId`, re-run the script |

More bot-level troubleshooting: [`docs/modules/core.md → Troubleshooting`](../modules/core.md#troubleshooting).
