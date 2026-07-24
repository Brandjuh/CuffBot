# Module: welcome 👋

> The front desk — greets every newcomer in the lobby with a themed welcome, the moment they join.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (S34): a welcome message in the lobby when someone joins |
| **Commands** | `/welcome-config` (admin) — also as `!welcome-config` |
| **Events** | `GuildMemberAdd` — **needs the privileged Server Members Intent** (portal switch) |
| **Default channel** | `411609312037961729` (owner's lobby, committed as product config; overrides win) |
| **Data** | `welcomeConfig` (enabled, channelId, message) in the guild store |

## Commands

### /welcome-config (admin — Manage Server)

- **Options:** `enabled` (bool), `channel` (text channel), `message` (custom text — `{user}` becomes the newcomer's mention, `{server}` the server name; greedy in `!welcome-config` text form), `test` (bool — posts the welcome right now with YOU as the newcomer).
- The status embed shows a rendered preview and — crucially — whether the **Server Members Intent** is active; without it the bot cannot see joins at all.

## Behavior

- Default message: `🚔 **Welcome to the precinct, {user}!** Report to the front desk, grab a coffee ☕ and a donut 🍩 — and enjoy your stay at **{server}**.`
- Pings exactly the newcomer (`allowedMentions: { users: [id] }`), nobody else.
- Bots get no welcome ("bots get cuffs, not coffee").
- A missing/unsendable channel is a silent no-op (logged to the journal) — joining must never error.
- The logbook's 📥 member-join entry is separate: that one records, this one greets.

## Setup (one-time, required)

The join event only fires with the **Server Members Intent**: Developer Portal → your app → **Bot** → Privileged Gateway Intents → **Server Members Intent** → Save, then `/restart`. `/welcome-config` and `/radio-check` both show whether it is active.

## Testing

- Covered in `test/logbook-welcome.test.js`: default lobby + placeholder rendering, join → greeting with scoped ping, bot-join silence, disabled silence, unsendable-channel tolerance.
- **Manual (live server) checklist:**
  1. Enable the Server Members Intent (above), `/restart`.
  2. `/welcome-config test:True` → the welcome appears in the lobby with you as the newcomer.
  3. Have a test account join → greeting within a second, pinging only them.
  4. `/welcome-config message:Welkom {user} bij {server}! 🎉 test:True` → custom text preview + post.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No welcome on join, `test:True` works | Server Members Intent off (test bypasses the event) | Portal switch + `/restart` — the status embed says exactly this |
| No welcome at all | Disabled, or channel missing/unsendable | `/welcome-config` shows both; check send permissions |
| Wrong channel | Default is the owner's lobby | `/welcome-config channel:#other` |

## Changelog

| Session | Change |
|---|---|
| S34 | Created: lobby greeting with `{user}`/`{server}` templates, test shot, intent-aware status. |
