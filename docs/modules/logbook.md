# Module: logbook 📔

> The station logbook — every server event, written down: messages, members, moderation, voice, server structure, and invites, each category toggleable, all delivered to one log channel.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (S34): "ik wil alles loggen" — log everything Discord exposes |
| **Commands** | `/logbook` (admin) — also as `!logbook` |
| **Events** | 19 handlers across messages / members / moderation / voice / server / invites |
| **Data** | `logbookConfig` (enabled, channelId, six category booleans) in the guild store |
| **Intents** | Base set covers most; **members category needs the privileged Server Members Intent** (portal switch); full message content in delete/edit logs needs the Message Content intent |

## Commands

### /logbook (admin — Manage Server)

- **Options:** `enabled` (master switch), `channel` (text channel), plus one boolean per category: `messages`, `members`, `moderation`, `voice`, `server`, `invites`. None given = status view.
- **All categories default ON** — but nothing is logged until an admin picks a channel (logs are sensitive; that choice stays deliberate).
- The status embed shows every toggle and warns when the Server Members Intent is off (member events invisible).

## What gets logged

| Category | Events |
|---|---|
| 🗑️ **messages** | Message deleted (author/content/attachments when cached; honest "not cached" note otherwise), message edited (before → after, jump link), bulk purge (count) |
| 📥 **members** | Join (with account age), leave (with roles held), nickname changes, role add/remove — *needs Server Members Intent* |
| 🔨 **moderation** | Ban (with reason when available), unban |
| 🎙️ **voice** | Join/leave/move between voice channels (mute/deafen toggles deliberately ignored — pure noise) |
| 📁 **server** | Channel create/delete/rename, role create/delete/rename, emoji add/remove (topic/permission edits deliberately ignored) |
| 🎟️ **invites** | Invite created (code, target, inviter) / deleted |

## Design notes

- One delivery path (`service.js → postLog`): master switch → category toggle → **never logs events from the log channel itself** (no recursion) → embed, never pings. A failing log write never breaks the event that caused it.
- CuffBot's own messages are not logged (its starters, announcements, and log entries would be self-noise). Bot *reactions* elsewhere: other bots' messages ARE logged.
- Edits where the cached content is identical (embed resolves, pins) are skipped.
- Partials are reported honestly: a deleted message that predates the current boot logs as "not in my cache — author and content unknown".
- Models live in `lib/logformat.js` (pure, tested); handlers are thin guards around `postLog`.

## Testing

- `test/logbook-welcome.test.js`: model rendering per category (incl. partial-delete and unknown-before-edit), the postLog gate matrix (no channel / toggle off / master off / log-channel recursion), all-categories-default-on, and end-to-end fakes for delete/edit (incl. identical-content silence), join (account age), ban (reason), voice move vs mute-toggle silence, and the bot's-own-message skip.
- **Manual (live server) checklist:**
  1. `/logbook channel:#log-kanaal` → status shows all six categories ✅.
  2. Delete one of your own messages → 🗑️ entry with your text.
  3. Edit a message → ✏️ before/after.
  4. Hop between two voice channels → 🔀 entries.
  5. Create + delete a test role → 🛡️ entries.
  6. With Server Members Intent ON: have someone join/leave → 📥/📤 entries.
  7. `/logbook voice:False` → hop channels again → silence for voice, rest keeps logging.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing logs at all | No channel set, or master switch off | `/logbook` shows both |
| Joins/leaves/role changes missing | Server Members Intent off | Portal → Bot → Privileged Gateway Intents → **Server Members Intent** → `/restart`; `/logbook` and `/radio-check` both show this state |
| Deleted/edited messages show no content | Message not cached (sent before the current boot) or Message Content intent off | Expected for pre-boot messages; enable Message Content for full text |
| Too noisy | That's what the toggles are for | `/logbook <category>:False` |

## Changelog

| Session | Change |
|---|---|
| S34 | Created: six-category server logging with per-category toggles, honest partials, no-recursion guard, intent-aware status. |
