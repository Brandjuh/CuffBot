# Module: memorial 🕯️

> Fallen-heroes tracker — polls the Fallen Firefighters (firehero.org) and Fallen Officers (odmp.org) feeds and honors each new entry in that feed's own channel (S60; shared fallback channel supported), tagging the matching role. Respectful by design: no history floods, polite polling, one intentional ping.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (M12): track fallen firefighters + officers via RSS and tag the memorial roles |
| **Commands** | `!memorial` group (admin; S70 — `!memorial-config` still works as an alias) |
| **Events** | `ClientReady` — 30-minute polling sweep (plus one at boot) |
| **Feeds → roles** | 🚒 `firehero.org/feed/` (memorial-filtered, S61) → role `627943529544417300` · 🚓 `odmp.org/feed` → role `627946543273738240` (S61 correction — the old "role" id `451095508560379934` is actually the owner's officers CHANNEL, now the committed `odmpChannelId` default) |
| **Data** | `memorialConfig` (enabled, channelId, odmpChannelId, fireheroChannelId — S60) + `memorialSeen` (per-feed seen ids, capped at 200) in the guild store |
| **Dependencies** | none — the RSS parser is zero-dep pure JS (`lib/rss.js`), fetching uses built-in `fetch` |

## Commands

### !memorial (admin — Manage Server; S70 group command)

Bare `!memorial` = the status view: enabled, the shared fallback channel, and each feed with its role, its OWN target channel (marked "(shared)" when falling back), and baseline state. Subcommands:

| Subcommand | Does |
|---|---|
| `!memorial on` / `!memorial off` | Tracker on/off |
| `!memorial channel <#channel>` | Shared fallback channel |
| `!memorial officers-channel <#channel>` | Own channel for Fallen Officers (S60; wins over the shared one; default `451095508560379934` since S61) |
| `!memorial firefighters-channel <#channel>` | Own channel for Fallen Firefighters |
| `!memorial officers-role <@role>` / `firefighters-role <@role>` | Per-feed ping role (S62; the status view warns with the exact fixing subcommand when a configured role no longer exists) |
| `!memorial preview` | Fetches each feed **now** and shows its latest entry; nothing is posted, nothing is marked seen |
| `!memorial probe <url>` | S61 — fetch ANY candidate feed URL live from the bot host: item count + newest three titles/links; posts nothing, commits nothing |

All channel subcommands take text or announcement channels.
- Nothing is ever posted for a feed until it has a usable channel (its own or the shared fallback); a feed without one is skipped — and not even baselined — while the other keeps running.

## How it works

- **Item filter (S61)** — a feed can declare `match` rules (`linkIncludes`/`titleIncludes`); only matching items are honored. firehero.org has **no memorial-only feed** (its feeds carry all site news — owner finding), so the firehero feed passes only hero-profile items (links under `/fallen-firefighter/`); plain news can never post. `preview:True` shows "X of Y items pass the memorial filter" so a silent feed is explainable at a glance.
- **Unreachable ≠ empty (S61)** — a fetch failure returns null and changes nothing; an EMPTY (or all-filtered) successful fetch still baselines, so the first matching item that ever appears is posted rather than swallowed.
- **Baseline on first sight** — the first sweep of a feed marks every current matching item as seen **without posting**: a fresh install honors the fallen going forward instead of flooding years of history into the channel. The journal logs the baseline (`Memorial: baselined …`).
- **Sweeps** run every 30 minutes (memorial feeds update rarely; polling politely matters — the fetch also sends an honest User-Agent). Each sweep: fetch → parse → filter unseen → post **oldest first**, max 5 per feed per sweep (the rest stays unseen and posts next sweep).
- **Posting:** an embed (🕯️ title, link, date, "gone, but not forgotten") with the feed's role tagged in the message content — `allowedMentions` scoped to exactly that role. This is the one deliberate ping in CuffBot.
- **Failure honesty:** an unreachable feed or a broken channel logs a warning and retries next sweep — a failed post is *not* marked seen, so no entry is ever silently dropped. Feed items are only marked seen after their post succeeds.
- `lib/rss.js` is a targeted RSS 2.0 extractor (guid/link/title/pubDate) that survives CDATA, entities, and attribute-bearing tags; garbage input yields an empty list, never a crash. Items without a guid *or* link are dropped (nothing to dedupe on).

## Testing

- `test/memorial.test.js` (9 tests): parsing (order, CDATA + entity decoding, link-as-guid fallback, id-less items dropped, garbage → `[]`), numeric/hex entity decoding, oldest-first + cap + seen-store bounding, **baseline-then-post** sweep behavior with fake fetch (role tag + scoped allowedMentions asserted), no-repost idempotence, disabled/unconfigured no-ops, unreachable feeds, failed-send retry (unseen until delivered), embed rendering.
- No test touches the network — feeds are string fixtures served by a fake fetch.
- **Manual (live server) checklist:**
  1. `!memorial channel #memorial` then `!memorial preview` → status shows both feeds + their latest live entries.
  2. Wait for the first sweep (≤30 min) → journal shows `baselined` lines; the channel stays quiet.
  3. When a real new entry appears in a feed → post in the channel, tagging the right role.
  4. Confirm the two role ids still exist in the server (`!memorial` renders them as role mentions — a deleted role shows as invalid).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Nothing ever posts | No channel set, tracker disabled, or feeds simply have no new entries since the baseline | `!memorial` (shows all three); `!memorial preview` proves the feeds are reachable from the Pi |
| Firefighter feed never posts | The memorial filter passes no items — firehero's feeds may carry only news | `preview:True` shows the match count; probe candidate sources with `probe:<url>` and report the winner |
| "feed returned HTTP 403/…" in the journal | The site is blocking or rate-limiting | It retries every 30 min; persistent blocks may need a different User-Agent (code change) |
| A post has no role ping | Role deleted, or `allowedMentions` role id no longer exists | Check the role ids in `service.js → FEEDS` against the server |
| Duplicate posts | Should not happen (seen-store) — unless `data/<guild>.json` was restored from an old backup | Expected after a backup restore: entries newer than the backup re-post once |

## Changelog

| Session | Change |
|---|---|
| S21 | Created: zero-dep RSS parser, baseline-first-sweep, 30-min polite polling, per-feed role tagging, seen-store with retry-until-delivered. |
| S55 | Channel picker accepts Announcement (news) channels too (was text-only — an unselectable type read as "the bot can't post despite full rights"); posting resolves the configured channel via the API on a cache miss (`core/channels.js`). |
| S60 | Per-feed channels (owner request): `officers-channel:` / `firefighters-channel:` route each feed to its own channel, with the original `channel:` as shared fallback; a channel-less feed is skipped (not baselined) while the other posts. |
| S61 | Officers feed corrected & completed (owner): channel `451095508560379934` (was mis-committed as the ping role in S21), ping role `627946543273738240`. Firehero feed memorial-filtered (`/fallen-firefighter/` links only — no memorial-only feed exists). `probe:` option live-tests any candidate feed from the bot host; unreachable≠empty fetch semantics. |
| S62 | Per-feed ping roles adjustable from Discord (`officers-role:`/`firefighters-role:` — the committed firehero role turned out deleted on the live server); the sweep pings the override (scoped) and the status view calls out a vanished role instead of rendering @unknown-role. |
| S70 | Converted to the `!memorial` group (M17.2; `!memorial-config` stays as an alias): on/off, channel, officers-channel, firefighters-channel, officers-role, firefighters-role, preview, probe — bare `!memorial` = the status view. |
