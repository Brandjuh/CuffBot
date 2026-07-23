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

## Day-to-day operation

| Task | Command |
|---|---|
| Live logs | `journalctl -u cuffbot -f` |
| Status | `systemctl status cuffbot` |
| Restart | `sudo systemctl restart cuffbot` |
| Stop / disable autostart | `sudo systemctl stop cuffbot` / `sudo systemctl disable cuffbot` |
| Update to latest code | re-run `bash ~/CuffBot/scripts/setup-pi.sh` |
| Rotate the token | Reset in the Developer Portal → edit `~/CuffBot/.env` → `sudo systemctl restart cuffbot` |

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `git clone` asks for a password and rejects your GitHub password | Repo is private; git needs a token, not your password | Create the Personal Access Token described above and paste it as the password |
| Script aborts: "armv6 … no builds" | Pi 1 / Pi Zero | Use a Pi 2 or newer |
| "Command registration failed" | Token or client id wrong in `.env` | Fix `~/CuffBot/.env`, re-run the script |
| Service runs but bot is offline in Discord | Wrong token, or bot not invited to the precinct | `journalctl -u cuffbot -n 50`; check the invite step in README → Quickstart |
| `/radio-check` missing in the picker | Commands not registered after a change | Re-run the script (it re-registers), wait a few seconds, reopen Discord |
| Bot immediately leaves your server | That guild is not the home precinct — by design | Set the right id in `config.json → homeGuildId`, re-run the script |

More bot-level troubleshooting: [`docs/modules/core.md → Troubleshooting`](../modules/core.md#troubleshooting).
