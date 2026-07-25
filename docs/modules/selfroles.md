# Selfroles — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 59 · 2026-07-24

## Purpose

Owner request (S59): a self-service role list. The bot posts a list in the self-roles channel (`625276074833608705`, committed owner default) of every role members may give themselves, with owner-written info per role, and **toggle buttons** underneath — press a button to get the role, press it again to take it off. The self-assignable roles are read from the server's own role list: **everything positioned under the role named `self-roles`** (the header), so the owner curates the offer by simply arranging roles in Server Settings. The bot keeps the posted list current on its own and can always edit its own message.

## Commands

### /selfroles (admin — Manage Server)

- **Options:** `enabled` (bool), `channel` (text or announcement channel — where the list lives), `post` (bool — post the list now, or refresh the existing one), `role` + `info` (set the text shown next to that role; greedy in `!selfroles` text form) + `emoji` (shown on the role's line AND its button), `clear-info` (bool, with `role`). None given = setup view.
- **Reply:** ephemeral setup embed — enabled/channel/header state, the detected self-assignable roles (with their configured emoji and a 📝 mark when info text exists), every skipped role **with the reason**, and the outcome of a `post:`/info change.
- Setting or clearing info auto-refreshes the posted list; members never touch this command — they use the buttons.

## Events

| Event | Handler | What it does |
|---|---|---|
| `InteractionCreate` | `events/buttons.js` | The button pump (`selfroles:toggle:<roleId>` customIds only): toggles the role, answers ephemerally. Validated against the LIVE section on every press. |
| `GuildRoleCreate/Delete/Update` | `events/watch.js` | Debounce (15 s) into one refresh of the posted list — renames, reorders, additions, and removals under the header all land automatically. |
| `ClientReady` | `events/watch.js` | Boot catch-up refresh (~20 s after start), only once a list was posted — offline role changes can't leave the list stale. |

## Configuration

Stored per guild (sparse overrides; defaults live in code):

| Key | Default | Effect |
|---|---|---|
| `enabled` | `true` | Master switch |
| `channelId` | `625276074833608705` | Where the list lives (S59 owner decision, committed) |
| `headerName` | `self-roles` | The role name that marks the section header |

Per-role info in `selfrolesInfo` (`{ [roleId]: { text?, emoji? } }`); the posted message is tracked in `selfrolesMessage` (`{ channelId, messageId }`).

## Permissions & safety

- **Bot permissions:** Manage Roles, with CuffBot's role **above** the self-assignable roles; Send Messages in the list channel.
- **Member permissions:** none — the buttons are the whole point. `/selfroles` itself requires Manage Server.
- **Safety rails:**
  - **Elevated roles are never self-assignable.** A role under the header carrying Administrator, Manage Server/Roles/Channels/Messages/Webhooks, Moderate/Kick/Ban Members, or Mention Everyone is skipped and listed under "Skipped" with the reason — a self-service moderator role is a security hole, not a feature.
  - Managed (integration/bot) roles and `@everyone` are skipped; the section ends at the next divider-looking role (same rule as the academy ladder). Sanity cap: **125 roles** (S64 — five messages of 25 buttons); overflow is listed under "Skipped".
  - Every press is validated against the **live** section — a role that was moved out (or gained dangerous permissions) after posting is refused and the stale list refreshes itself.
  - Role writes carry audit reasons; toggle failures answer honestly ("my role probably sits below it").
  - The list embed and all button replies never ping (`allowedMentions: { parse: [] }`).

## How it works

- `lib/selfroles.js` (pure): header matching (decorations and case ignored), section selection under the header (skip managed/elevated/@everyone, stop at the next divider — `isSectionDivider` shared with the academy), the 25-button cap (Discord: 5 buttons × 5 rows), list-line rendering, button-label clamping (80 chars).
- `service.js`: live detection over `guild.roles.cache` (elevated = permission check, precomputed for the pure lib), the list payloads (S64: **one message per 25 roles** — Discord's button cap — each with its own embed section and buttons; the first carries the intro, later ones say "(continued)"), the **tracked message list** (`messageIds[]`, pre-S64 single-id records still recognized; per chunk: edit in place, post missing, delete surplus when the roster shrinks, best-effort cleanup when the list moves channels), a per-guild refresh lock, the 15 s debounced auto-refresh, and the toggle.
- Toggle = add when missing, remove when held — one button, both directions (owner spec).
- The channel resolves via `core/channels.js` (S55): announcement channels work, cache misses fall back to the API.

## Files

```
src/modules/selfroles/
  index.js              manifest (1 command, 5 events)
  service.js            store, detection, tracked message, toggle
  lib/selfroles.js      pure section + rendering rules
  commands/selfroles.js /selfroles (admin)
  events/buttons.js     the button pump
  events/watch.js       role-change debounce + boot catch-up
```

## Testing

- `test/selfroles.test.js`: header matching (decorated/case variants), section selection (divider stop, managed/elevated skips with reasons, 25-cap overflow), line rendering with emoji/info, label clamping, committed channel default, post→edit→repost-after-delete cycle, missing header/channel and disabled codes, toggle both directions + header/foreign-id refusals + blocked-write honesty, info round-trip/clear, button rows within Discord limits.
- **Manual (live server) checklist:**
  1. Create a role named `self-roles`; drag the self-assignable roles directly below it.
  2. `/selfroles` → setup view lists them (and shows skips with reasons).
  3. `/selfroles role:@Movie Night info:Pinged for movie evenings emoji:🎬` → saved, list refreshes.
  4. `/selfroles post:True` → the list appears in <#625276074833608705> with buttons.
  5. Press a button → ephemeral "You now have …"; press again → "removed".
  6. Rename/move a role under the header → the list updates itself within ~15 s.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "No role named self-roles found" | The header role doesn't exist (or is spelled differently) | Create it, or check `/selfroles` — the header name is shown |
| A role is missing from the list | It sits above the header, below a divider, is managed, or has elevated permissions | `/selfroles` shows every skipped role with the reason |
| Button says it can't toggle | CuffBot's role sits below the self-role | Move CuffBot's role above the self-assignable roles |
| List is stale | Refresh failed (channel perms) | `/selfroles post:True` reposts; check Send Messages in the channel |
| More than 125 roles under the header | The sanity cap (five messages of 25 buttons, S64) | The overflow is listed under "Skipped" — trim the section |

## Changelog

| Session | Change |
|---|---|
| S59 | Created: button-toggle self roles from the role-list section under the `self-roles` header, posted in `625276074833608705` (committed owner default); per-role info/emoji via `/selfroles`; self-updating tracked message (role-event debounce + boot catch-up); elevated/managed roles refused with visible reasons. |
| S64 | The list spans multiple messages (owner request: support well beyond 20 roles): one message per 25 buttons, cap raised 25 → 125; tracked `messageIds[]` with per-chunk edit/post/delete and legacy single-id migration. |
