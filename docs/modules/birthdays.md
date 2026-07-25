# Module: birthdays 🎂

> Birthday watch — members register their birthday once (own timezone supported) and the precinct celebrates them in the configured channel, on their own calendar day, once a year.

## At a glance

| | |
|---|---|
| **Purpose** | Owner request (M10): birthday announcements with per-member timezone support |
| **Commands** | `!birthday-set`, `!birthday-remove`, `!birthdays` (everyone), `!birthday` group (admin, S70; alias `!birthday-config`) |
| **Events** | `ClientReady` — starts a 10-minute sweep: birthday-role sync (S58) + announcements (idempotent) |
| **Data** | `birthdayUsers` (day, month, timeZone, lastAnnouncedYear per user) + `birthdayConfig` (enabled, channelId) in the guild store |
| **Default channel** | `411609312037961729` (S31, owner decision — committed as product config; `!birthday channel` overrides win) |
| **Birthday role** | `701577807070756946` (S58, owner decision) — worn for the celebrant's whole LOCAL birthday, added/removed by the sweep |
| **Privacy** | The birth **year** is stored (S44 changed the input to YYYY/MM/DD) but is **never announced** — only the day and month are ever shown |
| **Intents** | None beyond the base set |

## Commands

### !birthday-set

- **Args:** `<date>` as **YYYY/MM/DD** (S44 — e.g. `1990/05/23`), then `[timezone]` (IANA name, optional — default `America/New_York`, S32 owner decision: Eastern Time is the most-populated US zone). The timezone also takes the keyword form: `!birthday-set 1990/05/23 timezone:Europe/Amsterdam`.
- **What happens:** validates the calendar date (Apr 31 refused, **Feb 29 allowed**) and the timezone (`Intl` lookup), then stores the record. Setting again overwrites.
- **Reply:** an in-channel confirmation with the parsed date + timezone. The birth YEAR is stored but never announced.
- **Failure modes:** impossible date → themed refusal naming the YYYY/MM/DD form; unknown timezone → a refusal that **suggests the closest real zone names** (S94 — `Europe/Amster` comes back with `Europe/Amsterdam`). Before S94 the near-miss list lived in a slash autocomplete handler that could not fire, because S68 removed every slash command.

### !birthday-remove

Removes your record (confirms, and says so plainly if nothing was on file).

### !birthdays

- **Args:** `[count]` (1–15, default 5). Out of range is refused with the range stated.
- **Reply:** public embed of the next birthdays, soonest first — `TODAY 🎉`, `tomorrow`, or `in N days`, counted in each member's own timezone. Never pings.

### !birthday (admin — Manage Server; S70 group command, alias `!birthday-config`)

Bare `!birthday` = the status view (switch, channel, current birthday role). Subcommands:

| Subcommand | Does |
|---|---|
| `!birthday on` / `!birthday off` | Announcements on/off |
| `!birthday channel <#channel>` | Where birthdays are announced (text or announcement) |
| `!birthday role <@role>` (alias `birthday-role`) | Role celebrants wear all day (S58) |
| `!birthday norole` (alias `no-birthday-role`) | Stop handing out a birthday role |

- Since S31 announcements default to the owner's channel `411609312037961729`; `!birthday channel` repoints them, and the ⚠️ warning only appears if the configured channel is missing.

## How it works

- `lib/birthday.js` is pure calendar math: `localDateParts(now, tz)` (what day it is *for that member*, via `Intl.DateTimeFormat` — full-icu ships with Node), `isBirthdayOn`, `dueBirthdays`, `daysUntilBirthday`, `nextBirthdays`, validity checks.
- **Feb 29 rule:** leaplings are celebrated on Feb 29 in leap years and on **Mar 1** in other years — never skipped.
- **The sweep** (`events/birthday-sweep.js`): every 10 minutes (plus once at boot) `sweepBirthdays` finds members whose birthday has started in their own timezone and announces each in the configured channel. There is **no midnight job to miss** — a Pi that reboots overnight simply announces on the next tick.
- **Once per year, guaranteed:** each announcement stamps `lastAnnouncedYear` (the member's local year) **before** sending — a failed send skips that year instead of retry-spamming every 10 minutes, and overlapping ticks can never double-announce.
- The announcement pings **only** the birthday member (`allowedMentions: { users: [id] }`).
- **The birthday role (S58):** every sweep tick, `syncBirthdayRole` gives role `701577807070756946` to everyone whose LOCAL birthday it currently is (independent of the announce stamp — the role must last the whole day, not just the announcement moment) and takes it back once their day ends. The add is idempotent (skipped when already worn — no API spam); a failed removal is logged and retried next tick; **only roles the bot granted are ever removed** (`birthdayRoleHolders` store map) — a manually assigned role is never stripped; a member who left simply drops off the list. Role writes carry audit reasons. Runs BEFORE the announcement, so the celebrant already wears the role when the message lands. Needs Manage Roles with CuffBot's role above the birthday role.
- **Donut gift (S38):** the announcement grants the birthday member **50,000 donuts** via the economy module (cross-module seam, try/catch — a broken economy never silences the birthday) and says so in the message. If the economy is disabled, both the gift and the line are skipped.

## Testing

- `test/birthdays.test.js` (14 tests): month lengths + Feb 29 validity, timezone validation, `localDateParts` across the date line (one fixed instant = July 24 in Amsterdam **and** July 23 in New York), the Feb 29 leap/non-leap rule, due-selection (wrong-day / already-announced / corrupt records skipped), day counting incl. year wrap, ordering, store round-trip, sweep idempotence (same day silent, next year fires), disabled/unconfigured no-ops, stamp-before-send under a failing channel, sparse config.
- **Manual (live server) checklist:**
  1. `!birthday channel #general` → status shows the channel.
  2. `!birthday-set day:<today> month:<this month>` → within ~10 min the announcement appears, pinging only you.
  3. Re-run `!birthdays` → you show as **TODAY**; another member a few days out shows `in N days`.
  4. `!birthday-set day:31 month:4` → refused. `!birthday-set day:29 month:2` → accepted.
  5. `!birthday-set … timezone:America/New_York` as a test user → the announcement day follows New York, not Amsterdam.
  6. `!birthday-remove` → confirm; `!birthdays` no longer lists you.
  7. `!birthday-set 24 7 Europe/Amsterdam` → text path works the same.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| No announcement on the day | No channel configured, or announcements disabled | `!birthday` — the status shows both switches |
| The birthday role never appears | No role configured, missing Manage Roles, or CuffBot's role sits below it | `!birthday` shows the role; check the role hierarchy |
| The role stays after the birthday | Removal is failing (hierarchy/permissions) — it retries every 10 min | Fix the hierarchy; the sweep removes it on the next tick |
| Announcement came "a day early/late" | The member's timezone differs from yours | By design: their day, their timezone. Check with `!birthdays` |
| Announcement missing after a reboot | Sweep only marks *after* it announces — it catches up on the next tick | Wait ≤10 min after boot; check `journalctl -u cuffbot` for "Birthdays: announcement failed" (missing send permission) |
| Member left but still listed | Records are not pruned automatically | `!birthday-remove` can only be run by the member; hand-edit `data/<guild>.json → birthdayUsers` if needed |

## Changelog

| Session | Change |
|---|---|
| S19 | Created: set/remove/list/config, per-member timezones, 10-min idempotent sweep, Feb 29 rule, no birth year stored. |
| S31 | Default announcement channel committed: `411609312037961729` (owner decision). |
| S32 | Default timezone → `America/New_York` (owner decision: US-based community; Eastern is the most-populated US zone). |
| S38 | Birthday members receive 50,000 donuts (economy seam), announced inside the birthday message. |
| S44 | `!birthday-set` input is now a single **YYYY/MM/DD** date (year validated 1900–now, real leap-year checking; stored but never announced) and the timezone option is a **typed picker** (autocomplete over the full IANA list, US zones first). |
| S55 | Channel picker accepts Announcement (news) channels too (was text-only — an unselectable type read as "the bot can't post despite full rights"); posting resolves the configured channel via the API on a cache miss (`core/channels.js`). |
| S58 | Celebrants wear role `701577807070756946` (committed owner default) for their whole local birthday — sweep-synced add/remove with retry, idempotent adds, never strips manually granted roles; `/birthday-config birthday-role:`/`no-birthday-role:` knobs. |
| S70 | `/birthday-config` became the `!birthday` group (M17.2; alias `!birthday-config`): on/off, channel, role, norole. |
| S94 | All three converted to the flat `{ command }` shape (M17.3 slice B) and given their first tests. The S44 timezone autocomplete is gone — it could only fire for a slash option, and S68 removed those — so `suggestTimeZones` now powers a "did you mean…" line in the refusal instead. Manual corrected: it still listed the pre-S44 `day`/`month` options and claimed the birth year is never stored. |
