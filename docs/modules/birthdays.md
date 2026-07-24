# Module: birthdays 🎂

> Birthday watch — members register their birthday once (own timezone supported) and the precinct celebrates them in the configured channel, on their own calendar day, once a year.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (M10): birthday announcements with per-member timezone support |
| **Commands** | `/birthday-set`, `/birthday-remove`, `/birthdays` (everyone), `/birthday-config` (admin) — all also as `!command` |
| **Events** | `ClientReady` — starts a 10-minute announcement sweep (idempotent) |
| **Data** | `birthdayUsers` (day, month, timeZone, lastAnnouncedYear per user) + `birthdayConfig` (enabled, channelId) in the guild store |
| **Default channel** | `411609312037961729` (S31, owner decision — committed as product config; `/birthday-config` overrides win) |
| **Privacy** | No birth **year** is ever asked or stored — only day + month + timezone |
| **Intents** | None beyond the base set |

## Commands

### /birthday-set

- **Options:** `day` (1–31, required), `month` (1–12, required), `timezone` (IANA name, optional — default `America/New_York`, S32 owner decision: Eastern Time is the most-populated US zone).
- **What happens:** validates the calendar date (Apr 31 refused, **Feb 29 allowed**) and the timezone (`Intl` lookup), then stores the record. Setting again overwrites.
- **Reply:** ephemeral confirmation with the parsed date + timezone.
- **Failure modes:** impossible date → themed refusal; unknown timezone → refusal listing valid examples (`America/New_York`, `America/Chicago`, …).

### /birthday-remove

Removes your record (ephemeral confirmation; says so if nothing was on file).

### /birthdays

- **Options:** `count` (1–15, default 5).
- **Reply:** public embed of the next birthdays, soonest first — `TODAY 🎉`, `tomorrow`, or `in N days`, counted in each member's own timezone. Never pings.

### /birthday-config (admin — Manage Server)

- **Options:** `enabled` (bool), `channel` (text channel). None given = view.
- Since S31 announcements default to the owner's channel `411609312037961729`; setting `channel:` repoints them, and the ⚠️ warning only appears if the configured channel is missing.

## How it works

- `lib/birthday.js` is pure calendar math: `localDateParts(now, tz)` (what day it is *for that member*, via `Intl.DateTimeFormat` — full-icu ships with Node), `isBirthdayOn`, `dueBirthdays`, `daysUntilBirthday`, `nextBirthdays`, validity checks.
- **Feb 29 rule:** leaplings are celebrated on Feb 29 in leap years and on **Mar 1** in other years — never skipped.
- **The sweep** (`events/birthday-sweep.js`): every 10 minutes (plus once at boot) `sweepBirthdays` finds members whose birthday has started in their own timezone and announces each in the configured channel. There is **no midnight job to miss** — a Pi that reboots overnight simply announces on the next tick.
- **Once per year, guaranteed:** each announcement stamps `lastAnnouncedYear` (the member's local year) **before** sending — a failed send skips that year instead of retry-spamming every 10 minutes, and overlapping ticks can never double-announce.
- The announcement pings **only** the birthday member (`allowedMentions: { users: [id] }`).
- **Donut gift (S38):** the announcement grants the birthday member **50,000 donuts** via the economy module (cross-module seam, try/catch — a broken economy never silences the birthday) and says so in the message. If the economy is disabled, both the gift and the line are skipped.

## Testing

- `test/birthdays.test.js` (14 tests): month lengths + Feb 29 validity, timezone validation, `localDateParts` across the date line (one fixed instant = July 24 in Amsterdam **and** July 23 in New York), the Feb 29 leap/non-leap rule, due-selection (wrong-day / already-announced / corrupt records skipped), day counting incl. year wrap, ordering, store round-trip, sweep idempotence (same day silent, next year fires), disabled/unconfigured no-ops, stamp-before-send under a failing channel, sparse config.
- **Manual (live server) checklist:**
  1. `/birthday-config channel:#general` → embed shows the channel.
  2. `/birthday-set day:<today> month:<this month>` → within ~10 min the announcement appears, pinging only you.
  3. Re-run `/birthdays` → you show as **TODAY**; another member a few days out shows `in N days`.
  4. `/birthday-set day:31 month:4` → refused. `/birthday-set day:29 month:2` → accepted.
  5. `/birthday-set … timezone:America/New_York` as a test user → the announcement day follows New York, not Amsterdam.
  6. `/birthday-remove` → confirm; `/birthdays` no longer lists you.
  7. `!birthday-set 24 7 Europe/Amsterdam` → text path works the same.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No announcement on the day | No channel configured, or announcements disabled | `/birthday-config` — the embed shows both switches |
| Announcement came "a day early/late" | The member's timezone differs from yours | By design: their day, their timezone. Check with `/birthdays` |
| Announcement missing after a reboot | Sweep only marks *after* it announces — it catches up on the next tick | Wait ≤10 min after boot; check `journalctl -u cuffbot` for "Birthdays: announcement failed" (missing send permission) |
| Member left but still listed | Records are not pruned automatically | `/birthday-remove` can only be run by the member; hand-edit `data/<guild>.json → birthdayUsers` if needed |

## Changelog

| Session | Change |
|---|---|
| S19 | Created: set/remove/list/config, per-member timezones, 10-min idempotent sweep, Feb 29 rule, no birth year stored. |
| S31 | Default announcement channel committed: `411609312037961729` (owner decision). |
| S32 | Default timezone → `America/New_York` (owner decision: US-based community; Eastern is the most-populated US zone). |
| S38 | Birthday members receive 50,000 donuts (economy seam), announced inside the birthday message. |
| S44 | `/birthday-set` input is now a single **YYYY/MM/DD** date (year validated 1900–now, real leap-year checking; stored but never announced) and the timezone option is a **typed picker** (autocomplete over the full IANA list, US zones first). |
