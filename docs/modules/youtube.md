# Module: youtube 📺

> Upload watch — follows one or more YouTube creators via their public feeds (no API key) and posts every new video link in the configured channel, where Discord renders it as a playable card.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (S52): when followed creators upload, post the video link in a specific channel |
| **Commands** | `/youtube` (admin) — also as `!youtube` |
| **Events** | `ClientReady` — 10-minute feed sweep (plus one tick ~15 s after boot) |
| **Data** | `youtubeConfig` (enabled, channelId) + `youtubeCreators` ({name, seenVideoIds} per creator) |
| **Network** | YouTube's public Atom feeds only (`youtube.com/feeds/videos.xml?channel_id=UC…`) — **no API key** |

## Commands

### /youtube (admin — Manage Server)

- **Options:** `enabled` (master switch), `channel` (where uploads are announced), `add` (creator: `UC…` channel ID, a `youtube.com/channel/…` URL, or an `@handle`), `remove` (name or ID), `preview` (fetches live, shows each creator's latest video, posts nothing). None given = status view with the full roster.
- **`add` semantics:** the feed is fetched once to validate the creator and learn their channel name, and every EXISTING video is baselined as seen — adding a creator never floods the channel with their back catalog; only uploads from that moment on are announced. `@handle` inputs are resolved with one page fetch.
- Roster cap: 25 creators (status embed stays readable).

## Behavior

- **Sweep:** every 10 minutes (and ~15 s after every restart) each creator's feed is fetched (15 s timeout). New videos post **oldest-first**, capped at 3 per creator per sweep (a feed hiccup can never flood).
- **Announcement:** `📺 **Creator** just uploaded: **Title**` followed by the plain video URL — Discord auto-embeds the playable card. Never pings.
- **Reliability:** a failed FETCH skips that creator for one tick; a failed SEND leaves the video unseen so the next sweep retries it. Seen-lists ring at 50 ids per creator.
- Nothing posts until an admin picks the announcement channel (`/youtube channel:#…`) — the owner named no channel, so none is invented.

## Design notes

- Pure logic in `lib/feed.js` (Atom parsing with CDATA/entity handling, creator-input parsing, new-video picking, seen-ring, announcement formatting); `service.js` owns the store and fetching (injectable `fetchImpl` — tests never touch the network); the sweep event is a thin guarded timer.
- Same zero-dependency feed approach as the memorial module (S21), adapted for Atom's `<entry>` shape.

## Testing

- `test/youtube.test.js`: feed parsing (entities, CDATA, garbage), creator-input matrix (ID/URLs/@handles/junk), new-video picking (unseen-only, oldest-first, cap), seen-ring, announcement format, @handle resolution via fake fetch, add (name + baseline + dupe + fetch-failure), sweep end-to-end (nothing-new silence, new upload posted with link and no pings, seen-silence, failed-send retry), disabled/unconfigured no-ops, remove by name and ID.
- **Manual (live server) checklist:**
  1. `/youtube channel:#uploads add:@SomeCreator` → confirmation with the creator's name and latest video; nothing posts yet.
  2. `/youtube preview:True` → shows the latest video per creator without posting.
  3. When the creator uploads → within ~10 min the link appears in #uploads as a playable card.
  4. `/youtube remove:SomeCreator` → roster updated.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing ever posts | No channel set, disabled, or empty roster | `/youtube` status shows all three |
| A creator was added but old videos never appeared | By design — the back catalog is baselined on add | Only NEW uploads are announced |
| "YouTube did not answer" on add | Wrong ID/handle, or YouTube briefly unreachable | Check the input; try again |
| Uploads appear late | The sweep runs every 10 minutes | Expected — worst case ~10 min after upload |

## Changelog

| Session | Change |
|---|---|
| S52 | Created: multi-creator upload announcements via public Atom feeds (no API key), baseline-on-add, 10-min sweep with failed-send retry, `/youtube` admin command with @handle resolution and live preview. |
