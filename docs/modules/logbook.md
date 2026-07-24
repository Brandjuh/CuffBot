# Module: logbook 📔

> The station logbook — every server event, written down: messages, members, moderation, voice, server structure, and invites, each category toggleable, all delivered to one log channel.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (S34): "ik wil alles loggen" — log everything Discord exposes |
| **Commands** | `/logbook` (admin) — also as `!logbook` |
| **Events** | 19 handlers across messages / members / moderation / voice / server / invites |
| **Data** | `logbookConfig` (enabled, per-category channels + booleans, optional single-channel override) in the guild store |
| **Default channels** | The owner's live log channels, committed per category (S35) — table below; overrides win |
| **Intents** | Base set covers most; **members category needs the privileged Server Members Intent** (portal switch); full message content in delete/edit logs needs the Message Content intent |

## Commands

### /logbook (admin — Manage Server)

- **Options:** `enabled` (master switch), `channel` (ONE channel for every category — overrides the per-category defaults), one boolean per category (`messages` … `invites`), and one channel per category (`messages-channel` … `invites-channel`). None given = status view showing where each category lands.
- **All categories default ON** and the owner's live log channels are committed per-category defaults (S35) — the logbook works the moment the bot updates, zero setup.
- **Channel precedence per category:** explicit `<category>-channel:` → explicit `channel:` (single-channel override) → committed default.
- The status embed shows every toggle + target channel and warns when the Server Members Intent is off (member events invisible).

## What gets logged

| Category | Events | Default channel (S35, owner) |
|---|---|---|
| 🗑️ **messages** | Message deleted (author/content/attachments when cached; honest "not cached" note otherwise), message edited (before → after, jump link), bulk purge (count) | `494216579794337802` (Message log) |
| 📥 **members** | Join (with account age), leave (with roles held), nickname changes, role add/remove — *needs Server Members Intent* | `494216579136094217` (Member logs) |
| 🔨 **moderation** | Ban (with reason when available), unban | `494216581216337931` (Mod logs) |
| 🎙️ **voice** | Join/leave/move between voice channels (mute/deafen toggles deliberately ignored — pure noise) | `494216579136094217` (shares Member logs — voice is member activity) |
| 📁 **server** | Channel create/delete/rename, role create/delete/rename, emoji add/remove (topic/permission edits deliberately ignored) | `494216580545380372` (Server logs) |
| 🎟️ **invites** | Invite created (code, target, inviter) / deleted | `494216580545380372` (shares Server logs — invites are server management) |

## Design notes

- One delivery path (`service.js → postLog`): master switch → category toggle → per-category channel resolution → **never logs events from ANY log channel** (deleting old log entries must not produce new ones) → embed, never pings. A failing log write never breaks the event that caused it.
- CuffBot's own messages are not logged (its starters, announcements, and log entries would be self-noise). Bot *reactions* elsewhere: other bots' messages ARE logged.
- Edits where the cached content is identical (embed resolves, pins) are skipped.
- Partials are reported honestly: a deleted message that predates the current boot logs as "not in my cache — author and content unknown".
- Models live in `lib/logformat.js` (pure, tested); handlers are thin guards around `postLog`.

## Testing

- `test/logbook-welcome.test.js`: model rendering per category (incl. partial-delete and unknown-before-edit), the committed default channels (incl. voice→members and invites→server sharing), out-of-the-box per-category routing, the switch/override matrix (toggle off / master off / single-channel override / per-category override / any-log-channel recursion), all-categories-default-on, and end-to-end fakes for delete/edit (incl. identical-content silence), join (account age), ban (reason), voice move vs mute-toggle silence, and the bot's-own-message skip.
- **Manual (live server) checklist:**
  1. `/logbook` (no options) → status shows all six categories ✅ each pointing at your log channels.
  2. Delete one of your own messages → 🗑️ entry with your text.
  3. Edit a message → ✏️ before/after.
  4. Hop between two voice channels → 🔀 entries.
  5. Create + delete a test role → 🛡️ entries.
  6. With Server Members Intent ON: have someone join/leave → 📥/📤 entries.
  7. `/logbook voice:False` → hop channels again → silence for voice, rest keeps logging.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing logs at all | Master switch off, or the default channels no longer exist | `/logbook` shows the switch and where each category points |
| A category should land elsewhere | Defaults are the owner's four log channels | `/logbook <category>-channel:#other` (or `channel:#one-place` for everything) |
| Joins/leaves/role changes missing | Server Members Intent off | Portal → Bot → Privileged Gateway Intents → **Server Members Intent** → `/restart`; `/logbook` and `/radio-check` both show this state |
| Deleted/edited messages show no content | Message not cached (sent before the current boot) or Message Content intent off | Expected for pre-boot messages; enable Message Content for full text |
| Too noisy | That's what the toggles are for | `/logbook <category>:False` |

## Changelog

| Session | Change |
|---|---|
| S34 | Created: six-category server logging with per-category toggles, honest partials, no-recursion guard, intent-aware status. |
| S35 | Owner's four log channels committed as per-category defaults (voice→Member logs, invites→Server logs); per-category `…-channel` overrides + single-channel override; recursion guard covers every log channel. |
