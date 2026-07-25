# Module: youtube 📺

> Upload watch — follows one or more YouTube creators via their public feeds (no API key) and posts every new video link in the configured channel, where Discord renders it as a playable card.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (S52): when followed creators upload, post the video link in a specific channel; S53: ping role `625326875442675763` on every new video |
| **Commands** | `!youtube` group (admin) — the S69 reference Red-style group command |
| **Events** | `ClientReady` — 10-minute feed sweep (plus one tick ~15 s after boot) |
| **Data** | `youtubeConfig` (enabled, channelId, pingRoleId) + `youtubeCreators` ({name, seenVideoIds} per creator) |
| **Network** | YouTube's public Atom feeds only (`youtube.com/feeds/videos.xml?channel_id=UC…`) — **no API key** |

## Commands

### !youtube (admin — Manage Server; S69 group command)

Bare `!youtube` shows the status view (enabled, channel with a live S55 post-probe, ping target, roster) plus the subcommand overview. Subcommands:

| Subcommand | Does |
|---|---|
| `!youtube on` / `!youtube off` | Master switch for upload announcements |
| `!youtube channel <#channel>` | Where uploads are announced — text **or Announcement/news** channel (S55); other types are refused |
| `!youtube add <creator>` (alias `follow`) | Follow a creator: `UC…` channel ID, a `youtube.com/channel/…` URL, or an `@handle` |
| `!youtube remove <creator>` (alias `unfollow`) | Unfollow by name or channel ID |
| `!youtube preview` | Fetches live, shows each creator's latest video, posts nothing |
| `!youtube pingrole <@role>` | Role pinged on every new upload |
| `!youtube noping` | Stop pinging any role |

- **`add` semantics:** the feed is fetched once to validate the creator and learn their channel name, and every EXISTING video is baselined as seen — adding a creator never floods the channel with their back catalog; only uploads from that moment on are announced. `@handle` inputs are resolved with one page fetch. The bot shows a typing indicator while fetching.
- Roster cap: 25 creators (status embed stays readable).

## Behavior

- **Sweep:** every 10 minutes (and ~15 s after every restart) each creator's feed is fetched (15 s timeout). New videos post **oldest-first**, capped at 3 per creator per sweep (a feed hiccup can never flood).
- **Announcement:** `📺 **Creator** just uploaded: **Title**` followed by the plain video URL — Discord auto-embeds the playable card. Since S53 the message leads with a role mention (owner default: role `625326875442675763`), and `allowedMentions` is scoped to exactly that role — nothing else in the message can ever ping. With `no-ping` set, announcements are fully silent (`allowedMentions: { parse: [] }`).
- **Reliability:** a failed FETCH skips that creator for one tick; a failed SEND leaves the video unseen so the next sweep retries it. Seen-lists ring at 50 ids per creator.
- Nothing posts until an admin picks the announcement channel (`!youtube channel #…`) — the owner named no channel, so none is invented.

## Design notes

- Pure logic in `lib/feed.js` (Atom parsing with CDATA/entity handling, creator-input parsing, new-video picking, seen-ring, announcement formatting); `service.js` owns the store and fetching (injectable `fetchImpl` — tests never touch the network); the sweep event is a thin guarded timer.
- Same zero-dependency feed approach as the memorial module (S21), adapted for Atom's `<entry>` shape.

## Testing

- `test/youtube.test.js`: feed parsing (entities, CDATA, garbage), creator-input matrix (ID/URLs/@handles/junk), new-video picking (unseen-only, oldest-first, cap), seen-ring, announcement format (with and without the ping role), the committed ping-role default, @handle resolution via fake fetch, add (name + baseline + dupe + fetch-failure), sweep end-to-end (nothing-new silence, new upload posted with link + leading role mention + scoped allowedMentions, seen-silence, failed-send retry, cleared-ping silence), disabled/unconfigured no-ops, remove by name and ID, and the S69 group wiring (roster of subcommands + ManageGuild gate, on/off, channel type refusal, pingrole/noping, remove-through-sub, status lines incl. the S55 probe).
- **Manual (live server) checklist:**
  1. `!youtube channel #uploads` then `!youtube add @SomeCreator` → confirmation with the creator's name and latest video; nothing posts yet.
  2. `!youtube preview` → shows the latest video per creator without posting.
  3. When the creator uploads → within ~10 min the link appears in #uploads as a playable card, opening with the ping for role `625326875442675763` (and members holding that role actually get notified).
  4. `!youtube remove SomeCreator` → roster updated; bare `!youtube` shows the full status any time.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing ever posts | No channel set, disabled, or empty roster | Bare `!youtube` status shows all three |
| Channel is set but still nothing posts | Configured channel deleted, wrong type, or hidden from the bot | `!youtube` status live-probes the channel and says "I can't post there" (S55) |
| Announcements don't ping | `noping` was set, or the role was deleted | `!youtube pingrole @role` sets a (new) target |
| The wrong role gets pinged | The ping role was changed | `!youtube` status shows the current target |
| A creator was added but old videos never appeared | By design — the back catalog is baselined on add | Only NEW uploads are announced |
| "YouTube did not answer" on add | Wrong ID/handle, or YouTube briefly unreachable | Check the input; try again |
| Uploads appear late | The sweep runs every 10 minutes | Expected — worst case ~10 min after upload |

## Changelog

| Session | Change |
|---|---|
| S52 | Created: multi-creator upload announcements via public Atom feeds (no API key), baseline-on-add, 10-min sweep with failed-send retry, `/youtube` admin command with @handle resolution and live preview. |
| S53 | New-upload announcements ping role `625326875442675763` (committed owner default), scoped via `allowedMentions: { roles: […] }`; `/youtube ping-role:` retargets, `no-ping:True` silences; status embed shows the ping target. |
| S55 | `channel:` accepts Announcement (news) channels; the sweep resolves the channel via the API on a cache miss; the status embed live-probes the configured channel and warns when the bot cannot post there. |
| S69 | Converted to the reference Red-style group command (M17.1): `!youtube <sub>` with on/off, channel, add/follow, remove/unfollow, preview, pingrole, noping; bare `!youtube` = status + overview. Replaces the option-soup slash-style command; service and sweep unchanged. |
