# Core — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 1 · 2026-07-23

## Purpose

Core is the precinct's front desk: it proves the bot is alive (`/radio-check`) and enforces CuffBot's single-precinct design — the bot serves exactly one guild (the *home precinct*, set in `config.json`) and automatically leaves any other server it is invited to. Every other module builds on the loader/config/logger plumbing this module exercises.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `/radio-check` | Confirms the bot is on the air and reports round-trip latency | none | Everyone | `/radio-check` |

### /radio-check

- **Options:** none.
- **What happens:** the bot replies immediately with "📻 Radio check…", measures the round-trip time between your invocation and its own reply message, then edits the reply with a verdict.
- **Reply:** visible to the channel (not ephemeral). Verdict bands: under 150 ms "Loud and clear", under 400 ms "Reading you with a bit of static", otherwise "Signal is rough out there" — always with the measured milliseconds.
- **Failure modes:** none specific. If the bot does not respond at all, it is offline or commands were never registered — see Troubleshooting.

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
| `src/modules/core/events/on-duty.js` | Ready log + offline-invite sweep |
| `src/modules/core/events/guild-lockdown.js` | Live jurisdiction enforcement |
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
| Bot leaves a server immediately | That server is not the home precinct — working as designed | Change `config.json → homeGuildId` only if the precinct itself moves |

## Changelog

| Session | Change |
|---|---|
| S1 | Created: `/radio-check`, on-duty sweep, guild lockdown, core plumbing (config/logger/loader), tests. |
