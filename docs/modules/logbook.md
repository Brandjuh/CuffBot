# Module: logbook 📔

> The station logbook — every server event, written down: messages, members, moderation, voice, server structure, and invites, each category toggleable, all delivered to one log channel.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (S34): "ik wil alles loggen" — log everything Discord exposes |
| **Commands** | `!logbook` group (admin; S70) |
| **Events** | 19 handlers across messages / members / moderation / voice / server / invites |
| **Data** | `logbookConfig` (enabled, per-category channels + booleans, optional single-channel override) in the guild store |
| **Default channels** | The owner's live log channels, committed per category (S35) — table below; overrides win |
| **Intents** | Base set covers most; **members category needs the privileged Server Members Intent** (portal switch); full message content in delete/edit logs needs the Message Content intent |

## Commands

### !logbook (admin — Manage Server; S70 group command)

Bare `!logbook` = the status view showing every toggle + target channel (and an intent warning when member events are invisible). Subcommands:

| Subcommand | Does |
|---|---|
| `!logbook on` / `!logbook off` | Master switch for all logging |
| `!logbook toggle <category> <on\|off>` | One category on/off (`messages`, `members`, `moderation`, `voice`, `server`, `invites`) |
| `!logbook route <category> <#channel>` | Send one category to its own channel |
| `!logbook channel <#channel>` | ONE channel for every category (overrides the per-category defaults) |

- **All categories default ON** and the owner's live log channels are committed per-category defaults (S35) — the logbook works the moment the bot updates, zero setup.
- **Channel precedence per category:** explicit `route` target → explicit `channel` (single-channel override) → committed default.

## What gets logged

| Category | Events | Default channel (S35, owner) |
|---|---|---|
| 🗑️ **messages** | Message deleted (author/content/attachments when cached; honest "not cached" note otherwise), message edited (before → after, jump link), bulk purge (count) | `494216579794337802` (Message log) |
| 📥 **members** | Join (with account age), leave (with roles held), nickname changes, role add/remove — *needs Server Members Intent* | `494216579136094217` (Member logs) |
| 🔨 **moderation** | Ban (with reason when available), unban | `494216581216337931` (Mod logs) |
| 🎙️ **voice** | Join/leave/move between voice channels (mute/deafen toggles deliberately ignored — pure noise) | `494216579136094217` (shares Member logs — voice is member activity) |
| 📁 **server** | Channel create/delete/rename, role create/delete/rename, emoji add/remove, **role permission changes** and **channel permission changes** (S113) — only channel *topic* edits are still ignored | `494216580545380372` (Server logs) |
| 🎟️ **invites** | Invite created (code, target, inviter) / deleted | `494216580545380372` (shares Server logs — invites are server management) |

## Design notes

- One delivery path (`service.js → postLog`): master switch → category toggle → per-category channel resolution → **never logs events from ANY log channel** (deleting old log entries must not produce new ones) → embed, never pings. A failing log write never breaks the event that caused it.
- CuffBot's own messages are not logged (its starters, announcements, and log entries would be self-noise). Bot *reactions* elsewhere: other bots' messages ARE logged.
- Edits where the cached content is identical (embed resolves, pins) are skipped.
- Partials are reported honestly: a deleted message that predates the current boot logs as "not in my cache — author and content unknown".
- Models live in `lib/logformat.js` (pure, tested); handlers are thin guards around `postLog`.

### Permission changes (S113)

Until S113 both `GuildRoleUpdate` and `ChannelUpdate` reported **renames only** — a channel's permission edits were discarded with the comment *"topic/permission edits are noise"*. They are the opposite of noise: who may do what is the change most worth a paper trail, and once Discord's own audit log ages out it is the only trace left. The owner noticed exactly this (*"Er zijn wat permissies veranderd echter zijn deze niet gelogd"*).

What is reported now:

- **Role permissions** — what was granted and what was revoked, by name. **Administrator gets its own alarm line and turns the entry 🚨**, because it silently contains every other permission; burying it in an alphabetical list would be the most misleading thing this module could do.
- **Channel overwrites** — per affected target (role or member), split into *added* (a new exception), *removed* (the target falls back to the server-wide permission — easy to miss, and the usual way a channel quietly opens up) and *edited*. An edit diffs allow **and** deny separately: moving a permission from allow to deny is two changes, and reporting one of them would describe a lockdown as an unlock.
- A rename and a permission change in the same edit produce **two entries**, so neither hides the other.
- A bulk edit touching many targets is capped at 8 and **says how many it dropped** — a silently truncated permission log reads as a complete one, which is worse than no log.
- Bits this discord.js build does not know (a permission Discord ships later) are dropped rather than printed as raw numbers.

All of it files under the **server** category, so it lands in the channel that category points at and follows it if that is ever re-routed.

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
  8. **Permissions (S113):** open a channel's settings → Permissions → change one toggle for any role → 🔐 **Channel permissions changed** appears in Server logs naming the role and the permission. Then Server Settings → Roles → grant a test role one extra permission → 🛡️ **Role permissions changed**. Grant that test role **Administrator** → the entry is 🚨 with the callout line. Change only a channel's *topic* → nothing is logged, which is correct.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing logs at all | Master switch off, or the default channels no longer exist | `/logbook` shows the switch and where each category points |
| A category should land elsewhere | Defaults are the owner's four log channels | `/logbook <category>-channel:#other` (or `channel:#one-place` for everything) |
| Joins/leaves/role changes missing | Server Members Intent off | Portal → Bot → Privileged Gateway Intents → **Server Members Intent** → `/restart`; `/logbook` and `/radio-check` both show this state |
| Deleted/edited messages show no content | Message not cached (sent before the current boot) or Message Content intent off | Expected for pre-boot messages; enable Message Content for full text |
| Too noisy | That's what the toggles are for | `/logbook <category>:False` |
| Permission changes still not logged | The Pi has not picked up S113 yet, or the **server** category is off / routed elsewhere | `!logbook` shows the toggle and the channel; `npm run doctor` shows whether the checkout is current |
| A permission entry names a role as a raw id | The role was deleted in the same edit, so there is nothing left to mention | Expected — the id is kept so the entry is still auditable |

## Changelog

| Session | Change |
|---|---|
| S34 | Created: six-category server logging with per-category toggles, honest partials, no-recursion guard, intent-aware status. |
| S35 | Owner's four log channels committed as per-category defaults (voice→Member logs, invites→Server logs); per-category `…-channel` overrides + single-channel override; recursion guard covers every log channel. |
| S55 | Log-channel pickers accepts Announcement (news) channels too (was text-only — an unselectable type read as "the bot can't post despite full rights"); posting resolves the configured channel via the API on a cache miss (`core/channels.js`). |
| S113 | **Permission changes are logged** (owner request): role permission grants/revokes by name with an Administrator alarm, and channel overwrite changes per target with allow/deny diffed separately. Both used to be discarded — `ChannelUpdate` returned early on anything but a rename, calling permission edits "noise". New pure `lib/permissions.js`; 23 tests, incl. one that reproduces the owner's exact case. |
| S70 | Converted to a Red-style group (M17.2): `!logbook on/off`, `toggle <category> <on|off>`, `route <category> <#channel>`, `channel <#channel>` — replaces the 14-option flat command. |
