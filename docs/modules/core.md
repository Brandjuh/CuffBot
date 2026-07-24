# Core — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 1 · 2026-07-23

## Purpose

Core is the precinct's front desk: it proves the bot is alive (`/radio-check`) and enforces CuffBot's single-precinct design — the bot serves exactly one guild (the *home precinct*, set in `config.json`) and automatically leaves any other server it is invited to. Every other module builds on the loader/config/logger plumbing this module exercises.

## Dual invocation: `/command` and `!command`

Every CuffBot command works two ways: as a **slash command** (`/radio-check`) or as a **text command** (`!radio-check`). Text invocation is handled centrally (`src/core/prefix/`), so every current and future command gets it for free — nothing per-command to maintain.

- The prefix is `config.json → prefix` (default `!`).
- Text arguments are positional and the last text option is greedy: `!detain @user 2h being a repeat offender` maps to `target`, `duration`, then `reason`.
- Replies that are ephemeral as a slash command (rap sheets, refusals) are sent to the user's **DMs** as a text command, so sensitive output never becomes public.
- **Text commands need the Message Content intent** (privileged). If it is not enabled in the Developer Portal, the bot still boots and runs slash commands; text commands and patrol stay disabled and a startup warning explains how to enable it (Bot → Privileged Gateway Intents → Message Content Intent). See Troubleshooting.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `/radio-check` | Confirms the bot is on the air and reports round-trip latency | none | Everyone | `/radio-check` |
| `/help` | Shows every loaded command (grouped by module) and how to use it | none | Everyone | `/help` |
| `/update` | Updates the bot from GitHub with live status in Discord; restarts only when the tests pass | none | Administrators / guild owner | `/update` |

### /radio-check

- **Options:** none.
- **What happens:** the bot replies immediately with "📻 Radio check…", measures the round-trip time between your invocation and its own reply message, then edits the reply with a verdict.
- **Reply:** visible to the channel (not ephemeral). Verdict bands: under 150 ms "Loud and clear", under 400 ms "Reading you with a bit of static", otherwise "Signal is rough out there" — always with the measured milliseconds.
- **Failure modes:** none specific. If the bot does not respond at all, it is offline or commands were never registered — see Troubleshooting.

### /help

- **Options:** none.
- **What happens:** generates the command roster from the modules that are actually loaded (never a hand-maintained list), grouped by module, showing both the `/name` and `!name` forms plus a usage hint. Public (everyone benefits from seeing it).

### /update

- **Options:** none. **Who:** Administrators or the guild owner only (checked at runtime, not just by the command's default visibility).
- **What happens:** triggers the same test-gated self-updater the timer uses (`scripts/update.sh`: fetch → tests must pass → deploy-commands → restart), so a manual update is exactly as safe as an automatic one — a red suite rolls back and the running bot is untouched. Prefers the `cuffbot-update` systemd unit (runs outside the bot's own lifecycle); falls back to a detached script run.
- **Live status in Discord (S25):** the reply updates as the update progresses — `✅ Already up to date` when nothing is new; `🔄 New version fetched (old → new), tests running…` when something arrived; `🚨 FAILED its tests and was rolled back` when the gate refused it. When the update succeeds, the restart kills the bot mid-command — the order is remembered in the store, and right after boot the bot posts **"✅ Update complete: `old` → `new` — back on duty"** in the channel where `/update` was typed, pinging the admin who ordered it (core's `update-report` boot event; stale orders >30 min are dropped silently).
- **Reliability:** wants the systemd update unit + the scoped sudoers drop-in that `setup-pi.sh` step 8 installs. Without them it still attempts a detached run. One update order at a time — a second `/update` while one runs is refused.

## Events

| Event | Handler | What it does |
|---|---|---|
| `ClientReady` (once) | `events/on-duty.js` | Logs "🚔 CuffBot on duty", leaves every guild that is not the home precinct (covers invites received while offline), and warns if the bot is not in the home precinct yet. |
| `GuildCreate` | `events/guild-lockdown.js` | If the bot is added to any guild other than the home precinct while running, it logs the event and leaves immediately. |

## Configuration

| Setting | Where | Required | Meaning |
|---|---|---|---|
| `DISCORD_TOKEN` | `.env` | yes | Bot token from the Developer Portal. Secret — never committed. |
| `CLIENT_ID` | `.env` | yes | Application id from the Developer Portal. |
| `homeGuildId` | `config.json` | yes | The one guild CuffBot serves (currently `411157175948541954`). Non-secret product setting, committed on purpose. |
| `LOG_LEVEL` | environment (optional) | no | `debug`, `info` (default), `warn`, or `error`. |

Boot fails fast with a named-variable error message when required settings are missing or malformed.

## Permissions & safety

- **Bot permissions needed:** none beyond being in the guild — `/radio-check` replies in-channel via the interaction, which needs no channel permissions. The invite link in the README requests *Send Messages* as a sane baseline for future modules.
- **Default member permissions:** `/radio-check` is available to everyone by design (it is diagnostic and harmless).
- **Safety rails:** the guild lockdown (see Events) is the module's main rail: the bot cannot silently spread to servers the owner never intended. Leaving a guild is not destructive — the bot can always be re-invited.
- **Intents:** only `Guilds` (no privileged intents). Member/message-content intents are deliberately postponed until a module needs them.

## How it works

1. `src/index.js` loads config (fail-fast), creates the client with the `Guilds` intent, exposes config as `client.config`, and asks the loader to wire everything.
2. `src/core/loader.js` scans `src/modules/*/index.js`, validates each manifest (`{ name, description, commands[], events[] }`), registers commands into a `Collection`, and attaches event handlers with an error-logging wrapper. Duplicate command names fail the boot on purpose.
3. The interaction router in `index.js` dispatches slash commands and answers any crash with an ephemeral in-theme apology while logging the real error.
4. Pure logic lives in `lib/` (`precinct.js` jurisdiction check, `radio.js` latency verdicts) with no discord.js imports, so tests run without a token.
5. `src/deploy-commands.js` reuses the same module discovery and registers all commands **guild-scoped to the home precinct** — instant propagation, and consistent-by-construction with what the loader loads.

## Files

| Path | Role |
|---|---|
| `src/modules/core/index.js` | Manifest |
| `src/modules/core/commands/radio-check.js` | `/radio-check` command |
| `src/modules/core/commands/help.js` | `/help` — generated command roster |
| `src/modules/core/commands/update.js` | `/update` — manual self-update (admin-only) |
| `src/modules/core/events/on-duty.js` | Ready log + offline-invite sweep |
| `src/modules/core/events/guild-lockdown.js` | Live jurisdiction enforcement |
| `src/core/prefix/{parse,adapter,router}.js` | Dual invocation: text (`!command`) support |
| `src/core/help.js` | Pure help-roster construction (used by `/help`) |
| `src/modules/core/lib/precinct.js` | Pure: home-guild check |
| `src/modules/core/lib/radio.js` | Pure: latency verdict formatting |
| `src/core/{config,logger,loader}.js` | Plumbing exercised by this module |
| `test/{config,loader,core-lib}.test.js` | Automated coverage |

## Testing

- **Automated:** `npm test` (11 tests) — config fail-fast validation and settings parsing (`test/config.test.js`), manifest/command/event integrity and duplicate-name detection (`test/loader.test.js`), jurisdiction + latency-verdict logic (`test/core-lib.test.js`). No token or network needed.
- **Manual (live server) checklist:**
  1. Complete README → Quickstart (fill `.env`, `npm install`, `npm run deploy-commands`, `npm start`).
  2. Console shows `🚔 CuffBot on duty as <bot tag>` and no warnings.
  3. In the home precinct, run `/radio-check` → reply appears and edits into a latency verdict.
  4. Invite the bot to a throwaway test server → console logs "Out of jurisdiction … leaving" and the bot leaves it within seconds.
  5. Stop the bot, invite it to a foreign server while it is offline, start it → the on-duty sweep leaves that server at boot.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Boot exits with "Missing required environment variables" | No `.env` or empty values | `cp .env.example .env`, fill in token + client id |
| Boot exits with "homeGuildId must be a Discord guild id" | `config.json` edited/broken | Restore a 17–20 digit guild id in `config.json` |
| `/radio-check` not in the command picker | Commands never registered, or registered before the bot joined | Run `npm run deploy-commands`; give Discord a few seconds; re-open the client |
| "The application did not respond" | Bot process not running (registration ≠ being online) | `npm start` and watch for the on-duty log line |
| Login fails with `TokenInvalid` / registration says Unauthorized | Wrong or rotated token, or token belongs to a different application than `CLIENT_ID` | `npm run doctor` — it checks the token against Discord and names the exact mismatch |
| `!commands` do nothing (but `/commands` work) | Message Content intent not enabled | Developer Portal → Bot → Privileged Gateway Intents → Message Content Intent → ON, then restart. The startup log warns when this is the cause. |
| `/update` replies but nothing happens | Update unit/sudoers not installed, or already up to date | Re-run `setup-pi.sh` step 8; check `journalctl -u cuffbot-update`. "Up to date" is a no-op by design. |
| **`!commands` don't work, slash commands do** | Message Content intent disabled in the portal — the bot cannot READ message text, so `!help` is invisible to it | `/radio-check` shows it (❌ Text commands OFF), `npm run doctor` verifies the portal flag. Fix: Developer Portal → your app → Bot → Privileged Gateway Intents → **Message Content Intent** ON → Save → `sudo systemctl restart cuffbot` |
| Bot leaves a server immediately | That server is not the home precinct — working as designed | Change `config.json → homeGuildId` only if the precinct itself moves |

## Changelog

| Session | Change |
|---|---|
| S1 | Created: `/radio-check`, on-duty sweep, guild lockdown, core plumbing (config/logger/loader), tests. |
| S9 | Added dual invocation (`/x` + `!x`) via `src/core/prefix/`, `/help` (generated roster), `/update` (manual self-update), Message Content intent with graceful slash-only fallback. |
| S25 | `/update` got a feedback loop: live status edits (up-to-date / fetched+testing / rolled-back) and a post-restart "back on duty" report in the invoking channel via the `update-report` boot event + a store marker. |
| S26 | `/radio-check` now reports whether `!` text commands are live (Message Content fallback made visible in Discord); the doctor decodes the portal's intent flags and names the exact portal fix. |
| S27 | `/update`'s "already up to date" is now verified against origin: an updater that never STARTED is reported as such (with the fix), instead of masquerading as up-to-date. |
