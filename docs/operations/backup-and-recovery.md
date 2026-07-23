# Backup, Recovery & Token Rotation

> Operations runbook for a running CuffBot. Companion to [`raspberry-pi.md`](raspberry-pi.md).

**Last updated:** Session 15 · 2026-07-23

## What is precious, and what isn't

| Data | Where | Precious? | Notes |
|---|---|---|---|
| Code, docs, config | git (`main`) | No — it's on GitHub | The Pi is disposable; re-clone any time. |
| **Member data** (rap sheets, evidence-locker channel, rank config, patrol config) | `data/<guildId>.json` on the Pi | **Yes** | Gitignored on purpose — never committed. This is the only state that lives *only* on the Pi. |
| Secrets | `~/CuffBot/.env` on the Pi | Yes | The token can always be regenerated in the portal; back it up only if convenient. |

So a backup is really about **`data/`** (and, optionally, `.env`).

## Backing up `data/`

`data/` is small JSON. A cron job is plenty:

```bash
# Nightly copy into a timestamped tarball under ~/cuffbot-backups (keep 14 days)
mkdir -p ~/cuffbot-backups
tar -czf ~/cuffbot-backups/data-$(date +%F).tgz -C ~/CuffBot data 2>/dev/null
find ~/cuffbot-backups -name 'data-*.tgz' -mtime +14 -delete
```

Add it with `crontab -e`:

```
30 4 * * * mkdir -p ~/cuffbot-backups && tar -czf ~/cuffbot-backups/data-$(date +\%F).tgz -C ~/CuffBot data 2>/dev/null && find ~/cuffbot-backups -name 'data-*.tgz' -mtime +14 -delete
```

For off-Pi safety, copy the tarballs elsewhere occasionally (`scp`, a USB stick, a cloud drive).

## Restoring

```bash
sudo systemctl stop cuffbot
tar -xzf ~/cuffbot-backups/data-YYYY-MM-DD.tgz -C ~/CuffBot
sudo systemctl start cuffbot
```

The store is resilient on its own too: a corrupt `data/<guild>.json` is moved aside to `data/<guild>.json.corrupt-<timestamp>` at read time and the bot starts fresh rather than crashing (see `records.md`). If that happens, the `.corrupt-*` file is your hand-recovery copy.

## Rotating the bot token

Rotate if the token is ever exposed (pasted somewhere, committed by mistake, leaked in logs), or on a routine schedule.

1. **Developer Portal** → your application → **Bot** → **Reset Token** → copy the new value **once** (each reset invalidates all older copies — see `discord-reference.md → Token hygiene`).
2. On the Pi:
   ```bash
   nano ~/CuffBot/.env      # replace DISCORD_TOKEN with the new value; save
   npm --prefix ~/CuffBot run doctor   # confirms the new token is valid and matches CLIENT_ID
   sudo systemctl restart cuffbot
   ```
3. Watch `journalctl -u cuffbot -f` for `🚔 CuffBot on duty`.

If a token ever lands in a git commit: reset it immediately (step 1) — the committed value is dead the moment you reset — and note it in `SESSION_LOG.md`.

## Moving to a new Pi

1. New Pi: run the one-command install (`raspberry-pi.md`).
2. Copy your latest `data/` backup into `~/CuffBot/` and extract it (Restoring, above).
3. `sudo systemctl restart cuffbot`.

Nothing else is Pi-specific — the code comes from GitHub and self-updates.
