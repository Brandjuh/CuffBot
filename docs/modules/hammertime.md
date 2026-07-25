# Hammertime — Module Manual

> Part of **CuffBot**, the police-themed Discord bot. This manual is the single source of truth for what the module does and how to operate it. If the code and this manual disagree, that is a bug — fix one of them and log it.

**Status:** stable
**Last updated:** Session 84 · 2026-07-25

## Purpose

The precinct clock desk: Hammertime, ported from Dumb-Cogs/hammertime (owner request, S65 batch → M16.11). Type a natural time phrase — `in 1 day and 12 hrs`, `saturday at 6:30pm`, `now` — and get Discord `<t:…>` timestamps that render correctly for **every** reader in their own timezone, in all seven styles with copyable codes. Backed by a per-member timezone registry with role defaults, a whole-precinct `list` view, and an optional auto-convert mode for plain chat messages.

## Commands

| Command | What it does | Key options | Who may use it | Example |
|---|---|---|---|---|
| `!hammertime` (alias `!ht`) | Group: convert, timezone registry, auto mode; bare = how-to + your zone + auto state | subs below | Everyone (`role`/`auto` gated) | `!ht in 2 hours` |

### !hammertime (S69-style group)

| Subcommand | Does |
|---|---|
| `!ht <phrase>` (sub `time`, the fallback; alias `for`) | Convert a phrase in YOUR timezone — put a member first (`!ht @officer 5pm`) to read it in THEIRS; add the word `list` for everyone's local time |
| `!ht tz <query>` (alias `timezone`) | Set your timezone — a city (`new york`), an IANA zone (`Europe/Amsterdam`), a current abbreviation (`edt`), or an offset (`utc+2`); ambiguous queries open a select (last option = "not listed / **remove**") |
| `!ht role <@role> <query>` | **Manage Roles:** give a role a default timezone — members without their own setting inherit it |
| `!ht auto [on\|off]` | **Manage Server:** auto-convert chat messages containing "at 5" / "in 20 min" into a quiet timestamp reply (bare = toggle) |

- **Output (cog-verbatim shape):** "**Hammertime!** — @you's **Saturday, Jul 25th at 6:30 PM** is your" followed by all seven `<t:ts:…>` styles, each as a copyable code AND rendered live, plus the set-your-timezone footer. Mentions render but never ping.
- **Phrases understood:**
  - *Relative (the cog's regex, ported):* `now`, `in 1 day and 12 hrs`, `an hour ago`, `2 weeks`, `5 mins and 30 secs` — cumulative, applied in order; `a`/`an` = 1; `ago` = backwards; months/years are calendar-safe (Jan 31 + 1 month = Feb 28) and all arithmetic is **wall-clock** ("in 1 day" = the same clock time tomorrow, even across a DST switch — Python aware-datetime semantics, preserved).
  - *Absolute (simplified fuzzy):* `today`/`tomorrow`/`yesterday`, weekday names (next occurrence, today included), `jan 5`/`5 jan`/`jan 5th`, `12/25` (US month/day, optional year), ISO `2026-12-25`, clock times `6:30pm`/`12am`/bare `at 6` (bare hour). Unknown words are skipped, missing time = midnight.
- **`list` mode:** everyone with a resolvable timezone, grouped by what their clock reads at that instant, west → east, alphabetical inside a group (single embed, truncated at ~4000 chars).
- **Auto mode (off by default):** a chat message containing "at <digit>" / "in <digit>" gets a quiet `-# <t:F> (<t:R>)` reply — relative phrases first; else exactly ONE bare `at H[:MM]` (two or more = silence) with the cog's quirky am/pm inference: current half of the day, flipped if that hour already passed (at 3:30 PM, "at 2" means 2 AM). Never triggers on `!ht` invocations or members without a timezone.

## Events

- `MessageCreate` — the auto-convert listener (gated on the toggle).
- `InteractionCreate` — the `htz:` timezone-picker selects.

## Configuration

- `hammertimeUsers` `{ userId: zone }`, `hammertimeRoles` `{ roleId: zone }`, `hammertimeConfig` `{ autoTime: false }` in the guild store. (The cog stored user timezones bot-globally; CuffBot is single-guild by design — S1.)
- **Timezone resolution (cog-exact):** your own setting wins; otherwise your roles' zones — **more than one timezone role is "ambiguous"** (the cog counts roles, not distinct zones; ported as-is) and none is "no timezone set", each with the cog's exact message.

## Permissions & safety

- **Member permissions:** convert + `tz` public; `role` needs Manage Roles (the cog's gate); `auto` Manage Server.
- Only the officer who ran `tz`/`role` may use the resulting select (cog rule); the picker expires after **60 s** (the cog's 10 s was punishingly short — recorded deviation) with the cog's "Took too long."
- **Pings:** none anywhere — conversions, list embeds, and auto replies all render mentions silently.
- Pending pickers are RAM-only; the registry and toggle persist.

## How it works

- `lib/time.js` (pure, Intl-based — replaces pytz): zone wall-clock conversions (`epochToZonedParts` / iterative `zonedPartsToEpoch`, lenient on DST-skipped times), the cog's calendar-safe `add_months`, wall-clock delta addition, and its exact `%A, %b %-d{th} at %-I:%M %p` display format.
- `lib/parse.js` (pure — replaces dateutil): the cog's relative regex ported verbatim with cumulative wall-clock application; a simplified fuzzy absolute parser (the cog ran dateutil `fuzzy=True` with today's date prefixed); the auto-mode pipeline with the am/pm inference quirk ported as-is. **Recorded deviation:** gibberish returns "I couldn't understand that" — the cog's fuzzy parse silently answered *today 00:00*.
- `lib/zones.js`: the cog's pytz abbreviation/city map rebuilt on `Intl.supportedValuesOf('timeZone')` — full names, city segments, **current** short names (the cog also indexed decades of historical pytz abbreviations; Intl exposes only the present — recorded simplification), numeric offsets matched against current offsets, and an alias fallback for zones Intl accepts but doesn't list (`US/Eastern`).
- `service.js`: the registry + resolution rule + auto toggle + pending-picker RAM state; `commands/hammertime.js` renders and owns the select flow; the two events are thin.

## Files

```
src/modules/hammertime/
  index.js                manifest
  lib/time.js             Intl zone math + cog display format
  lib/parse.js            relative + absolute + auto-mode parsers
  lib/zones.js            timezone lookup map (names/cities/abbrevs/offsets)
  service.js              registry, resolution, auto toggle, pending picks
  commands/hammertime.js  the group, output block, list view, select flow
  events/messages.js      auto-convert listener
  events/selects.js       htz: select pump
test/hammertime.test.js   zone math, parser fidelity, lookup, registry, group
```

## Testing

- `test/hammertime.test.js` (14 tests): zoned round-trips incl. the DST-skipped-time leniency and both seasonal offsets, calendar-safe months (clamp + leap + negative), the cog display format (12 AM/PM edges, ordinals), **the documented cog phrases** (`now`/`not now`, `1 hour ago`, `in 1 day and 12 hrs`, `an hour`, cumulative chains), wall-clock-across-DST pinned (23 real hours), the absolute-parser examples (`saturday at 6:30pm` on a Saturday = today, month names + ordinals, US dates, winter offsets, the gibberish deviation), delta-before-absolute ordering, the am/pm inference quirk, the auto pipeline (gate, one-`at`-max, explicit pm), zone lookup (city/abbrev/offset/alias/garbage — map seeded with a fixed July instant so winter runs stay deterministic), the registry resolution matrix, the seven-style output, list grouping west→east, and the group shape.
- **Manual (live server) checklist:**
  1. `!ht tz amsterdam` → "Your timezone is now Europe/Amsterdam."; `!ht tz gmt` → a select opens; pick one.
  2. `!ht in 2 hours` → the seven-style block; the `R` style reads "in 2 hours".
  3. `!ht saturday at 6:30pm` → Saturday 18:30 in YOUR zone; ask a colleague in another zone to confirm the rendered times differ correctly.
  4. `!ht @officer 9am` → their 9 AM in your rendering; `!ht 5pm list` → the grouped local-times embed.
  5. `!ht auto on`, then type "let's meet at 5" → a quiet `-#` timestamp reply appears.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "You have no timezone set." | The registry is per member | `!ht tz <city or zone>` once |
| "multiple timezone roles" | Two of your roles carry timezones (cog rule: roles, not zones) | Set your own with `!ht tz` — it always wins |
| "I couldn't understand that" | The phrase has no recognizable time — or a typo in the unit | Try the documented shapes: `in 2 hours`, `saturday at 6:30pm`, `12/25 at 7pm` |
| An abbreviation finds the wrong zone | Abbreviations are ambiguous (EDT covers many zones) and only CURRENT ones are indexed | Use the city or the IANA name instead |
| Auto mode ignored a message | Off by default; needs "at/in <digit>", ONE bare "at H", and your timezone set | `!ht auto on`, check `!ht` status |

## Changelog

| Session | Change |
|---|---|
| S84 | Created (M16.11, Dumb-Cogs port): natural-phrase → seven `<t:…>` styles (cog-verbatim block), per-member timezone registry with role defaults + the ambiguity rule, select-based zone disambiguation (city/abbrev/offset queries), `list` mode (west→east grouping — the cog's sort was a no-op on identical instants, fixed), auto-convert mode with the cog's am/pm inference quirk. dateutil/pytz replaced by hand-rolled Intl parsers (relative regex verbatim, wall-clock DST semantics preserved, calendar-safe months). Deviations recorded: gibberish refuses instead of answering today-midnight; only current zone abbreviations indexed; picker timeout 60 s (was 10); bare `!ht` = overview (`!ht now` for the cog's default). |
