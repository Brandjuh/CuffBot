# Module: channellist 🗂️

> The precinct directory — a self-updating posted list of every category and channel (with its topic as description), ported from the owner's FRA bot cog.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (S36): "the same channel list as the FRA bot" — source: `FireAndRescueAcademyCogs/channellist` |
| **Commands** | `!channel-list` group (admin, S70 — actions + settings merged; alias `!channel-list-config`) |
| **Events** | Channel create/delete/update, role update/delete, (bulk) message delete, boot catch-up |
| **Data** | `channellistConfig` (channelId, messageIds, roleId, header, emoji, embedColor, includeVoice, autoUpdate, ignoredIds) |
| **Default channel** | None — the owner has not named one; post it once with `!channel-list post #…` |

## Commands

### !channel-list (admin — Manage Server; S70 group command — actions + settings in one group, alias `!channel-list-config`)

Bare `!channel-list` = the settings view. Subcommands:

| Subcommand | Does |
|---|---|
| `!channel-list post [#channel]` | (Re)post the full list, replacing any previous one — optionally into a new channel |
| `!channel-list update` | Refresh, **editing the existing messages in place** when possible |
| `!channel-list remove` | Delete the posted list |
| `!channel-list role <@role>` | Only channels THIS role can see are listed (default @everyone) |
| `!channel-list everyone` | Reset visibility to @everyone |
| `!channel-list header <text…>` | Intro text (greedy); `default` restores |
| `!channel-list emoji <emoji>` | Decorates category headers; `none` removes |
| `!channel-list color <hex>` | Embed color like `#5865f2`; `default` restores |
| `!channel-list voice <on\|off>` | Include voice and stage channels |
| `!channel-list autoupdate <on\|off>` (alias `auto-update`) | Refresh automatically when channels change |
| `!channel-list ignore <#channel>` | Hide a channel **or a whole category** from the list |
| `!channel-list unignore <#channel\|id>` | Show it again — accepts a raw id, so entries for deleted channels can be cleaned up |

- Honest result messages on post/update: up to date / edited / posted / reposted / no channel set / channel gone / missing permissions.
- Every settings change schedules an automatic refresh of the posted list.

## Behavior

- **Rendering:** channels appear in Discord-UI order — uncategorized channels first (no header), then each category (`**[Name]**`, optionally `**[🚔] [Name] [🚔]**`) with its text channels above its voice channels. Each line is `#mention - topic` (topic collapsed to one line). Only channels the visibility role can see are listed.
- **Chunking:** the list packs into as few embeds as possible (≤4000 chars each); a category header is never stranded at the bottom of one embed while its channels start in the next.
- **Sync engine:** on refresh the module decides per render — identical → skip (no writes); same message count → edit in place; grew, or any stored message was deleted → delete + repost. Message ids persist in the store, so restarts keep editing the same posted messages.
- **Auto-update:** channel create/delete/rename/move/topic/permission changes, role permission changes, and deletion of a posted list message all schedule a refresh, **debounced 10 s** so a burst of edits becomes one update. Boot catches up on changes made while the bot was offline. Auto-update only runs once a list is posted.
- Embeds never ping (`allowedMentions: { parse: [] }`).

## Design notes

- Pure logic (grouping, chunk packing, edit-vs-repost decision, input normalizers) lives in `lib/list.js`; `service.js` renders/delivers and holds the per-guild refresh lock + debounce; `events/watch.js` is thin guards.
- The FRA cog's behavior was preserved deliberately: same header default, same `[Category]` markup, same chunk limit, same edit/repost/skip decision rules, same 10 s debounce.
- A per-guild lock serializes refreshes (a manual `!channel-list update` and the debounced auto-refresh can never interleave their fetch/edit/send sequences).

## Testing

- `test/channellist.test.js`: formatting, UI-order grouping (uncategorized first, voice after text, hidden/ignored/orphan channels), includeVoice + ignore (channel and category), chunk packing incl. the never-strand-a-header rule, the repost/skip/edit decision matrix, color/emoji normalizers, descriptor collection + render integration, refresh end-to-end (post → skip → edit-in-place → repost after message deletion → force repost), removeList, debounce (burst → one edit; not armed before a list is posted), defaults.
- **Manual (live server) checklist:**
  1. `!channel-list post #directory` → the full list appears, grouped per category.
  2. Change a channel topic → within ~10 s the posted list updates (edited, not reposted).
  3. Rename/move a channel → same.
  4. Delete the posted list message → the list reposts itself.
  5. `!channel-list ignore #staff-category` → the whole category disappears from the list.
  6. `!channel-list role @Member` → the list now only shows what @Member can see.
  7. `!channel-list remove` → list deleted, auto-updates stop.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "No list channel set yet" | Nothing configured | `!channel-list post #…` |
| List never auto-updates | Auto-update off, or no list posted | `!channel-list` shows both |
| A private channel shows up | The visibility role can see it | `!channel-list role` (or fix the channel permissions) |
| List missing channels | Visibility role can't see them, or they're ignored | Settings view shows the role + ignored list |

## Changelog

| Session | Change |
|---|---|
| S36 | Created: full port of the FRA channellist cog — UI-order rendering, edit-in-place sync, 10 s debounced auto-updates, boot catch-up, visibility role, ignores, header/emoji/color options. |
| S55 | Channel picker accepts Announcement (news) channels too (was text-only — an unselectable type read as "the bot can't post despite full rights"); posting resolves the configured channel via the API on a cache miss (`core/channels.js`). |
| S70 | `!channel-list` and `!channel-list-config` merged into ONE group (M17.2; the config name stays as an alias): post/update/remove + role/everyone/header/emoji/color/voice/autoupdate/ignore/unignore (unignore accepts raw ids for deleted channels — replaces `unignore-id`). |
