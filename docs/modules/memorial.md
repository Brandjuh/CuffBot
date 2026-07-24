# Module: memorial 🕯️

> Fallen-heroes tracker — polls the Fallen Firefighters (firehero.org) and Fallen Officers (odmp.org) feeds and honors each new entry in the configured channel, tagging the matching role. Respectful by design: no history floods, polite polling, one intentional ping.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (M12): track fallen firefighters + officers via RSS and tag the memorial roles |
| **Commands** | `/memorial-config` (admin) — also as `!memorial-config` |
| **Events** | `ClientReady` — 30-minute polling sweep (plus one at boot) |
| **Feeds → roles** | 🚒 `firehero.org/feed/` → role `627943529544417300` · 🚓 `odmp.org/feed` → role `451095508560379934` (owner-specified, committed in `service.js → FEEDS`) |
| **Data** | `memorialConfig` (enabled, channelId) + `memorialSeen` (per-feed seen ids, capped at 200) in the guild store |
| **Dependencies** | none — the RSS parser is zero-dep pure JS (`lib/rss.js`), fetching uses built-in `fetch` |

## Commands

### /memorial-config (admin — Manage Server)

- **Options:** `enabled` (bool), `channel` (text channel), `preview` (bool — fetches each feed **now** and shows its latest entry ephemerally; nothing is posted, nothing is marked seen).
- **Reply:** ephemeral status — enabled, channel (with a ⚠️ until set), each feed with its role and baseline state.
- Nothing is ever posted until an admin sets a channel.

## How it works

- **Baseline on first sight** — the first sweep of a feed marks every current item as seen **without posting**: a fresh install honors the fallen going forward instead of flooding years of history into the channel. The journal logs the baseline (`Memorial: baselined …`).
- **Sweeps** run every 30 minutes (memorial feeds update rarely; polling politely matters — the fetch also sends an honest User-Agent). Each sweep: fetch → parse → filter unseen → post **oldest first**, max 5 per feed per sweep (the rest stays unseen and posts next sweep).
- **Posting:** an embed (🕯️ title, link, date, "gone, but not forgotten") with the feed's role tagged in the message content — `allowedMentions` scoped to exactly that role. This is the one deliberate ping in CuffBot.
- **Failure honesty:** an unreachable feed or a broken channel logs a warning and retries next sweep — a failed post is *not* marked seen, so no entry is ever silently dropped. Feed items are only marked seen after their post succeeds.
- `lib/rss.js` is a targeted RSS 2.0 extractor (guid/link/title/pubDate) that survives CDATA, entities, and attribute-bearing tags; garbage input yields an empty list, never a crash. Items without a guid *or* link are dropped (nothing to dedupe on).

## Testing

- `test/memorial.test.js` (9 tests): parsing (order, CDATA + entity decoding, link-as-guid fallback, id-less items dropped, garbage → `[]`), numeric/hex entity decoding, oldest-first + cap + seen-store bounding, **baseline-then-post** sweep behavior with fake fetch (role tag + scoped allowedMentions asserted), no-repost idempotence, disabled/unconfigured no-ops, unreachable feeds, failed-send retry (unseen until delivered), embed rendering.
- No test touches the network — feeds are string fixtures served by a fake fetch.
- **Manual (live server) checklist:**
  1. `/memorial-config channel:#memorial preview:True` → status shows both feeds + their latest live entries.
  2. Wait for the first sweep (≤30 min) → journal shows `baselined` lines; the channel stays quiet.
  3. When a real new entry appears in a feed → post in the channel, tagging the right role.
  4. Confirm the two role ids still exist in the server (`/memorial-config` renders them as role mentions — a deleted role shows as invalid).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing ever posts | No channel set, tracker disabled, or feeds simply have no new entries since the baseline | `/memorial-config` (shows all three); `preview:True` proves the feeds are reachable from the Pi |
| "feed returned HTTP 403/…" in the journal | The site is blocking or rate-limiting | It retries every 30 min; persistent blocks may need a different User-Agent (code change) |
| A post has no role ping | Role deleted, or `allowedMentions` role id no longer exists | Check the role ids in `service.js → FEEDS` against the server |
| Duplicate posts | Should not happen (seen-store) — unless `data/<guild>.json` was restored from an old backup | Expected after a backup restore: entries newer than the backup re-post once |

## Changelog

| Session | Change |
|---|---|
| S21 | Created: zero-dep RSS parser, baseline-first-sweep, 30-min polite polling, per-feed role tagging, seen-store with retry-until-delivered. |
