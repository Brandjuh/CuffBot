# Module: welcome 👋

> The front desk — greets every newcomer in the lobby with a themed welcome, the moment they join.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (S34): a welcome message in the lobby when someone joins |
| **Commands** | `!welcome` group (admin, S70; alias `!welcome-config`) |
| **Events** | `GuildMemberAdd` — **needs the privileged Server Members Intent** (portal switch) |
| **Default channel** | `411609312037961729` (owner's lobby, committed as product config; overrides win) |
| **Data** | `welcomeConfig` (enabled, channelId, message) in the guild store |

## Commands

### !welcome (admin — Manage Server; S70 group command, alias `!welcome-config`)

Bare `!welcome` = the status view with a rendered preview and — crucially — whether the **Server Members Intent** is active; without it the bot cannot see joins at all. Subcommands:

| Subcommand | Does |
|---|---|
| `!welcome on` / `!welcome off` | Welcomes on/off |
| `!welcome channel <#channel>` | Where newcomers are greeted |
| `!welcome message <text…>` | Custom text — `{user}` becomes the newcomer's mention, `{server}` the server name (greedy: the rest of the line) |
| `!welcome test` | Posts the welcome right now with YOU as the newcomer |

## Behavior

- Default message: `🚔 **Welcome to the precinct, {user}!** Report to the front desk, grab a coffee ☕ and a donut 🍩 — and enjoy your stay at **{server}**.`
- **Never pings** (S35 owner decision): the `{user}` mention renders as a highlighted name, but `allowedMentions: { parse: [] }` suppresses every notification.
- Bots get no welcome ("bots get cuffs, not coffee").
- A missing/unsendable channel is a silent no-op (logged to the journal) — joining must never error.
- The logbook's 📥 member-join entry is separate: that one records, this one greets.

## Setup (one-time, required)

The join event only fires with the **Server Members Intent**: Developer Portal → your app → **Bot** → Privileged Gateway Intents → **Server Members Intent** → Save, then `!restart`. `!welcome` and `!radiocheck` both show whether it is active.

## Testing

- Covered in `test/logbook-welcome.test.js`: default lobby + placeholder rendering, join → greeting with zero notifications, bot-join silence, disabled silence, unsendable-channel tolerance.
- **Manual (live server) checklist:**
  1. Enable the Server Members Intent (above), `/restart`.
  2. `!welcome test` → the welcome appears in the lobby with you as the newcomer.
  3. Have a test account join → greeting within a second, no notification for anyone.
  4. `!welcome message Welkom {user} bij {server}! 🎉` then `!welcome test` → custom text preview + post.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No welcome on join, `test:True` works | Server Members Intent off (test bypasses the event) | Portal switch + `/restart` — the status embed says exactly this |
| No welcome at all | Disabled, or channel missing/unsendable | `!welcome` shows both; check send permissions |
| Wrong channel | Default is the owner's lobby | `!welcome channel #other` |

## Changelog

| Session | Change |
|---|---|
| S34 | Created: lobby greeting with `{user}`/`{server}` templates, test shot, intent-aware status. |
| S35 | Newcomers are named but never pinged (owner decision) — mentions render, notifications suppressed. |
| S55 | Channel picker accepts Announcement (news) channels too (was text-only — an unselectable type read as "the bot can't post despite full rights"); posting resolves the configured channel via the API on a cache miss (`core/channels.js`). |
| S70 | Converted to the `!welcome` group (M17.2; alias `!welcome-config`): on/off, channel, message (greedy), test. |
