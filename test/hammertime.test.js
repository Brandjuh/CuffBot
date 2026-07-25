// Hammertime (S84 = M16.11, Dumb-Cogs port): the Intl time layer (zone
// conversions incl. DST edges, calendar-safe months, the cog's display
// format), the hand-rolled parsers against the cog's documented phrases
// (relative cumulative deltas with WALL-clock semantics, the simplified
// fuzzy absolute parser, the quirky auto-mode am/pm inference), the zone
// lookup map, the registry service, and the group shape.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { PermissionFlagsBits } from 'discord.js';
import {
  addMonthsParts,
  epochToZonedParts,
  formatUsersTime,
  offsetMinutesAt,
  th,
  zonedPartsToEpoch,
} from '../src/modules/hammertime/lib/time.js';
import {
  inferAmPm,
  parseAbsolute,
  parseAutoMessage,
  parseDelta,
  parsePhrase,
} from '../src/modules/hammertime/lib/parse.js';
import { buildTimezoneMap, lookupTimezones } from '../src/modules/hammertime/lib/zones.js';
import {
  clearAllPendingPicks,
  getAutoTime,
  getUserTimezone,
  resolveTimezone,
  setAutoTime,
  setRoleTimezone,
  setUserTimezone,
} from '../src/modules/hammertime/service.js';
import hammertimeCommand, { buildListGroups, hammertimeMessage } from '../src/modules/hammertime/commands/hammertime.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-hammertime-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
  clearAllPendingPicks();
});

const NY = 'America/New_York';
// Saturday 2026-07-25 15:30 EDT (UTC−4) — the fixed "now" for parser tests.
const NOW = Date.UTC(2026, 6, 25, 19, 30, 0);
// Seed the zone map deterministically (July offsets) before any test runs.
buildTimezoneMap(NOW);

const HOUR = 3_600_000;

let seq = 0;
const freshGuildId = () => `84000000000000${String((seq += 1)).padStart(4, '0')}`;

// ── the Intl time layer ──────────────────────────────────────────────────────

test('zoned conversions round-trip, including across DST', () => {
  const parts = epochToZonedParts(NOW, NY);
  assert.deepEqual(
    [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.dow],
    [2026, 7, 25, 15, 30, 6],
    'Saturday 15:30 EDT',
  );
  assert.equal(zonedPartsToEpoch(parts, NY), NOW, 'exact round-trip');
  assert.equal(offsetMinutesAt(NOW, NY), -240, 'EDT is UTC−4');
  const winter = Date.UTC(2026, 0, 15, 12, 0, 0);
  assert.equal(offsetMinutesAt(winter, NY), -300, 'EST is UTC−5');
  // A skipped wall time (2026-03-08 02:30 does not exist in New York)
  // resolves to a nearby valid instant, like lenient dateutil.
  const skipped = zonedPartsToEpoch({ year: 2026, month: 3, day: 8, hour: 2, minute: 30, second: 0 }, NY);
  const landed = epochToZonedParts(skipped, NY);
  assert.ok(Math.abs(landed.hour * 60 + landed.minute - 150) <= 60, 'lands within an hour of the requested wall time');
});

test('addMonthsParts is the cog add_months: day clamps to the target month', () => {
  const jan31 = { year: 2026, month: 1, day: 31, hour: 10, minute: 0, second: 0 };
  assert.deepEqual(addMonthsParts(jan31, 1).day, 28, '2026 February clamps to 28');
  assert.deepEqual(addMonthsParts({ ...jan31, year: 2028 }, 1).day, 29, 'leap February clamps to 29');
  const back = addMonthsParts(jan31, -2);
  assert.deepEqual([back.year, back.month, back.day], [2025, 11, 30], 'negative months cross the year');
});

test('th + formatUsersTime render the cog DT_FMT', () => {
  assert.deepEqual([th(1), th(2), th(3), th(4), th(11), th(13), th(21), th(22), th(23)], ['st', 'nd', 'rd', 'th', 'th', 'th', 'st', 'nd', 'rd']);
  assert.equal(formatUsersTime(NOW, NY), 'Saturday, Jul 25th at 3:30 PM');
  assert.equal(formatUsersTime(Date.UTC(2026, 6, 25, 4, 0, 0), NY), 'Saturday, Jul 25th at 12:00 AM', 'midnight is 12 AM');
  assert.equal(formatUsersTime(Date.UTC(2026, 6, 25, 16, 0, 0), NY), 'Saturday, Jul 25th at 12:00 PM', 'noon is 12 PM');
});

// ── parseDelta (the cog's relative regex, cumulative, wall-clock) ────────────

test('parseDelta: now / not now, and the documented example phrases', () => {
  assert.equal(parseDelta('now', NY, NOW), NOW);
  assert.equal(parseDelta('right now please', NY, NOW), NOW);
  assert.equal(parseDelta('not now', NY, NOW), null, '"not now" is not "now" (cog rule)');
  assert.equal(parseDelta('1 hour ago', NY, NOW), NOW - HOUR);
  assert.equal(parseDelta('in 1 day and 12 hrs', NY, NOW), NOW + 36 * HOUR, 'cumulative matches');
  assert.equal(parseDelta('an hour', NY, NOW), NOW + HOUR, 'a/an = 1');
  assert.equal(parseDelta('a day ago', NY, NOW), NOW - 24 * HOUR);
  assert.equal(parseDelta('2 weeks', NY, NOW), NOW + 14 * 24 * HOUR);
  assert.equal(parseDelta('5 mins and 30 secs', NY, NOW), NOW + 5 * 60_000 + 30_000);
  assert.equal(parseDelta('soon', NY, NOW), null, 'no relative match = ParserError');
});

test('parseDelta: months are calendar-safe and days are WALL-clock across DST', () => {
  // Jan 31, 10:00 EST + 1 month → Feb 28, 10:00 EST (clamped).
  const jan31 = Date.UTC(2026, 0, 31, 15, 0, 0);
  const plusMonth = parseDelta('in 1 month', NY, jan31);
  const p = epochToZonedParts(plusMonth, NY);
  assert.deepEqual([p.month, p.day, p.hour], [2, 28, 10]);
  // Mar 7 12:00 EST + 1 day → Mar 8 12:00 EDT: same wall hour, 23 real hours
  // (Python aware datetime + timedelta with gettz — the semantics we port).
  const beforeDst = Date.UTC(2026, 2, 7, 17, 0, 0);
  const nextDay = parseDelta('in 1 day', NY, beforeDst);
  assert.equal(epochToZonedParts(nextDay, NY).hour, 12, 'wall hour preserved');
  assert.equal(nextDay - beforeDst, 23 * HOUR, 'one real hour short across spring-forward');
});

// ── parseAbsolute (the simplified fuzzy dateutil) ────────────────────────────

test('parseAbsolute: the cog usage examples land on the right instants', () => {
  // "saturday at 6:30pm" on a Saturday = TODAY 18:30 (next occurrence, today included).
  assert.equal(parseAbsolute('saturday at 6:30pm', NY, NOW), Date.UTC(2026, 6, 25, 22, 30, 0));
  assert.equal(parseAbsolute('sunday at 9am', NY, NOW), Date.UTC(2026, 6, 26, 13, 0, 0), 'next weekday');
  assert.equal(parseAbsolute('tomorrow', NY, NOW), Date.UTC(2026, 6, 26, 4, 0, 0), 'date only = midnight');
  assert.equal(parseAbsolute('yesterday at 11pm', NY, NOW), Date.UTC(2026, 6, 25, 3, 0, 0));
  assert.equal(parseAbsolute('6:30pm', NY, NOW), Date.UTC(2026, 6, 25, 22, 30, 0), 'time only = today');
  assert.equal(parseAbsolute('at 6', NY, NOW), Date.UTC(2026, 6, 25, 10, 0, 0), 'bare hour, fuzzy words skipped');
  assert.equal(parseAbsolute('12am', NY, NOW), Date.UTC(2026, 6, 25, 4, 0, 0), '12am is midnight');
  assert.equal(parseAbsolute('12pm', NY, NOW), Date.UTC(2026, 6, 25, 16, 0, 0), '12pm is noon');
});

test('parseAbsolute: month names, numeric dates, winter offsets, and the gibberish deviation', () => {
  // Jan 5 (current year) in winter offset: 19:00 EST = UTC−5.
  assert.equal(parseAbsolute('jan 5 at 7pm', NY, NOW), Date.UTC(2026, 0, 6, 0, 0, 0), 'jan 5 19:00 EST');
  assert.equal(parseAbsolute('jan 5th', NY, NOW), Date.UTC(2026, 0, 5, 5, 0, 0), 'ordinal day after a month name');
  assert.equal(parseAbsolute('5 jan', NY, NOW), Date.UTC(2026, 0, 5, 5, 0, 0), 'day before the month name');
  assert.equal(parseAbsolute('12/25 at 12am', NY, NOW), Date.UTC(2026, 11, 25, 5, 0, 0), 'US month/day');
  assert.equal(parseAbsolute('12-25-2027', NY, NOW), Date.UTC(2027, 11, 25, 5, 0, 0), 'explicit year');
  // DEVIATION (recorded): the cog's fuzzy parse answered "today 00:00" to
  // gibberish; we refuse instead.
  assert.equal(parseAbsolute('foo bar', NY, NOW), null);
  assert.equal(parseAbsolute('at 99', NY, NOW), null, 'impossible hours refuse');
});

test('parsePhrase prefers the relative parse, falls back to absolute', () => {
  assert.deepEqual(parsePhrase('in 2 hours', NY, NOW), { epochMs: NOW + 2 * HOUR, kind: 'delta' });
  assert.equal(parsePhrase('saturday at 6:30pm', NY, NOW)?.kind, 'datetime');
  assert.equal(parsePhrase('wibble wobble', NY, NOW), null);
});

// ── auto mode ────────────────────────────────────────────────────────────────

test('inferAmPm: the cog quirk — current half of day, flipped for passed hours', () => {
  // now = 3:30 PM
  assert.equal(inferAmPm(5, NY, NOW), 'pm', '5 has not passed in the pm half');
  assert.equal(inferAmPm(2, NY, NOW), 'am', '2 pm already passed → flips to am');
  assert.equal(inferAmPm(15, NY, NOW), 'pm', '24h hours default pm');
  const morning = Date.UTC(2026, 6, 25, 13, 30, 0); // 9:30 AM EDT
  assert.equal(inferAmPm(11, NY, morning), 'am');
  assert.equal(inferAmPm(8, NY, morning), 'pm', '8 am already passed → flips to pm');
});

test('parseAutoMessage: the at/in gate, one bare "at H" max, quiet failures', () => {
  assert.equal(parseAutoMessage('see you at 5', NY, NOW), Date.UTC(2026, 6, 25, 21, 0, 0), 'at 5 → 5 PM today');
  assert.equal(parseAutoMessage('starting in 20 mins', NY, NOW), NOW + 20 * 60_000);
  assert.equal(parseAutoMessage('at 5 or maybe at 6', NY, NOW), null, 'two bare "at H" = silence');
  assert.equal(parseAutoMessage('no times here', NY, NOW), null, 'the at/in-digit gate');
  assert.equal(parseAutoMessage('meet at 7:15pm', NY, NOW), Date.UTC(2026, 6, 25, 23, 15, 0), 'explicit pm skips inference');
});

// ── zone lookup ──────────────────────────────────────────────────────────────

test('lookupTimezones: cities, abbreviations, offsets, aliases, garbage', () => {
  assert.ok(lookupTimezones('new_york', NOW).includes('America/New_York'));
  assert.ok(lookupTimezones('New York', NOW).includes('America/New_York'), 'spaces map to underscores');
  assert.ok(lookupTimezones('edt', NOW).includes('America/New_York'), 'current abbreviation (July)');
  assert.ok(lookupTimezones('utc+2', NOW).includes('Europe/Paris'), 'numeric offset (July DST)');
  assert.ok(lookupTimezones('Europe/Amsterdam', NOW).includes('Europe/Amsterdam'));
  assert.deepEqual(lookupTimezones('US/Eastern', NOW), ['US/Eastern'], 'Intl alias outside supportedValuesOf');
  assert.deepEqual(lookupTimezones('definitely-not-a-zone', NOW), []);
});

// ── the registry service ─────────────────────────────────────────────────────

test('timezone registry: own setting wins, role fallback, ambiguous, none', () => {
  const guildId = freshGuildId();
  assert.deepEqual(resolveTimezone(guildId, 'alice', []), { error: 'none' });
  setRoleTimezone(guildId, 'role-eu', 'Europe/Amsterdam');
  setRoleTimezone(guildId, 'role-us', 'America/New_York');
  assert.deepEqual(resolveTimezone(guildId, 'alice', ['role-eu']), { zone: 'Europe/Amsterdam' });
  assert.deepEqual(resolveTimezone(guildId, 'alice', ['role-eu', 'role-us']), { error: 'ambiguous' }, 'two timezone roles');
  setUserTimezone(guildId, 'alice', NY);
  assert.deepEqual(resolveTimezone(guildId, 'alice', ['role-eu', 'role-us']), { zone: NY }, 'own setting beats roles');
  setUserTimezone(guildId, 'alice', null);
  assert.equal(getUserTimezone(guildId, 'alice'), null, 'unset removes');
  setRoleTimezone(guildId, 'role-eu', null);
  assert.deepEqual(resolveTimezone(guildId, 'alice', ['role-eu']), { error: 'none' });
  assert.equal(getAutoTime(guildId), false, 'auto mode defaults off');
  setAutoTime(guildId, true);
  assert.equal(getAutoTime(guildId), true);
});

// ── rendering + group wiring ─────────────────────────────────────────────────

test('hammertimeMessage carries all seven styles; list groups sort west→east', () => {
  const message = hammertimeMessage('<@1>', 'Saturday, Jul 25th at 3:30 PM', 1_800_000_000, '!');
  for (const style of ['d', 'D', 't', 'T', 'f', 'F', 'R']) {
    assert.ok(message.includes(`\`<t:1800000000:${style}>\``), `style ${style} as code`);
    assert.ok(message.includes(`: <t:1800000000:${style}>`), `style ${style} rendered`);
  }
  const members = [
    { id: '1', displayName: 'Zed' },
    { id: '2', displayName: 'Ann' },
    { id: '3', displayName: 'Bob' },
    { id: '4', displayName: 'NoZone' },
  ];
  const zones = { 1: 'Europe/Amsterdam', 2: NY, 3: NY, 4: null };
  const groups = buildListGroups(members, (m) => zones[m.id], NOW);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].formatted, 'Saturday, Jul 25th at 3:30 PM', 'west (New York) first');
  assert.deepEqual(groups[0].members.map((m) => m.displayName), ['Ann', 'Bob'], 'alphabetical inside a group');
  assert.equal(groups[1].formatted, 'Saturday, Jul 25th at 9:30 PM', 'Amsterdam +2 in July');
});

test('!hammertime group shape: ht alias, time fallback, gated role/auto subs', () => {
  const group = hammertimeCommand.group;
  assert.equal(group.name, 'hammertime');
  assert.ok(group.aliases.includes('ht'));
  assert.equal(group.permission, undefined, 'the group is public');
  assert.equal(group.fallback, 'time');
  assert.deepEqual(
    group.subcommands.map((s) => [s.name, s.permission ?? null]),
    [
      ['time', null],
      ['tz', null],
      ['role', PermissionFlagsBits.ManageRoles],
      ['auto', PermissionFlagsBits.ManageGuild],
    ],
  );
  const time = group.subcommands[0];
  assert.equal(time.args[0].greedy, true, 'the phrase is greedy');
});
