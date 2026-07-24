# Module: starboard ⭐

> The commendation board — react with enough ⭐ on any message and CuffBot reposts it to the board channel: community-curated highlights, each message boarded exactly once.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (M13): "react with X stars and the post is placed in a reminder channel" |
| **Commands** | `/starboard-config` (admin) — also as `!starboard-config` |
| **Events** | `MessageReactionAdd` — watches for the ⭐ threshold |
| **Data** | `starboardConfig` (enabled, channelId, threshold, emoji) + `starboardPosted` (boarded map, bounded at 1000) in the guild store |
| **Intents/partials** | `GuildMessageReactions` (non-privileged, added to the base set) + `Message`/`Reaction`/`Channel` partials so stars on **old** messages (from before the current boot) still count |

## Commands

### /starboard-config (admin — Manage Server)

- **Options:** `enabled` (bool), `channel` (text channel), `threshold` (1–25, default 3). None given = view (also shows how many messages have been boarded).
- Nothing is boarded until an admin sets a channel.

## How it works

- Every ⭐ reaction add is judged by pure rules (`lib/board.js → shouldBoard`): starboard enabled + channel set + right emoji + not the board channel itself + not already boarded + count ≥ threshold. Bot reactors never count.
- **Boarding:** the message is reposted to the board channel as an embed — author name/avatar, content (clamped at 1000 chars; "no text" note for image-only messages), the first **image** attachment embedded, a *Jump to the original* link, source channel, and the star count. Never pings (`allowedMentions: { parse: [] }`).
- **Exactly once:** the boarded-map is claimed *synchronously before* the send (two near-simultaneous stars can't double-post); a failed send rolls the claim back so a later star retries. The map is bounded (1000 entries, oldest evicted).
- The star count shown is the count at boarding time — the board post is not edited as more stars arrive (deliberate simplicity).
- **Message text fidelity needs the Message Content intent** (already used for `!commands`): without it, boarded posts show the "no text" note plus attachments/links only.

## Testing

- `test/starboard.test.js` (9 tests): the full `shouldBoard` decision matrix, content clamping + image picking + empty-text fallback, boarded-map bounding/eviction, post-once + dedupe + rollback-on-failed-send, embed rendering, and the reaction event with fakes — threshold crossing boards once, 4th star doesn't re-board, wrong emoji/low count/bot reactor/foreign guild/board channel ignored, partial reactions fetched before judging.
- **Manual (live server) checklist:**
  1. `/starboard-config channel:#commendations threshold:2`.
  2. React ⭐⭐ (two accounts) on a normal message → it appears on the board with author, text, jump link.
  3. Add a third star → no duplicate post.
  4. Star an **image** message → the image renders in the board embed.
  5. Star a message on the board itself → nothing happens.
  6. Star a message from **before the last bot restart** → still boards (partials).
  7. `/starboard-config` → "Boarded so far" increments.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Stars do nothing | No channel set / disabled / threshold not reached | `/starboard-config` shows all three |
| Boarded post has no text | Message Content intent off | Enable it (see `operations/raspberry-pi.md`); attachments still board |
| Old messages don't board | Bot restarted **and** partials failed to fetch (deleted message?) | Re-star; if the message is gone, there is nothing to board |
| Same message boarded twice | Should be impossible (pre-send claim) — unless the store was restored from backup | Expected once after a restore; harmless |

## Changelog

| Session | Change |
|---|---|
| S22 | Created: ⭐-threshold watcher with partials, claim-before-send dedupe, bounded boarded-map, admin config. |
