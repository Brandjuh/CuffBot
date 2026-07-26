import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  birthdayCelebrants,
  daysUntilBirthday,
  dueBirthdays,
  formatBirthday,
  isBirthdayOn,
  isLeapYear,
  isValidBirthday,
  isValidTimeZone,
  localDateParts,
  nextBirthdays,
  parseBirthdayDate,
  suggestTimeZones,
  DEFAULT_TIMEZONE,
} from '../src/modules/birthdays/lib/birthday.js';
import birthdaysList from '../src/modules/birthdays/commands/birthdays.js';
// S106: `!birthday-set` / `!birthday-remove` are `!birthday set` / `remove`.
import birthdayGroup from '../src/modules/birthdays/commands/birthday.js';
import { dispatchCommand } from '../src/core/prefix/command.js';
import { dispatchGroup } from '../src/core/prefix/group.js';
import { fakeMessage } from './fixtures/fake-message.js';
import {
  getBirthdayConfig,
  getBirthdayUsers,
  removeBirthday,
  setBirthday,
  setBirthdayConfig,
  sweepBirthdays,
  syncBirthdayRole,
} from '../src/modules/birthdays/service.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-birthdays-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `70000000000000${String((seq += 1)).padStart(4, '0')}`;
const MEMBER = '700000000000000021';

// ── calendar validity ────────────────────────────────────────────────────────

test('isValidBirthday knows month lengths and allows Feb 29', () => {
  assert.equal(isValidBirthday(24, 7), true);
  assert.equal(isValidBirthday(29, 2), true, 'leaplings are real people');
  assert.equal(isValidBirthday(30, 2), false);
  assert.equal(isValidBirthday(31, 4), false, 'April has 30 days');
  assert.equal(isValidBirthday(0, 5), false);
  assert.equal(isValidBirthday(12, 13), false);
  assert.equal(isValidBirthday(1.5, 6), false);
});

test('isValidTimeZone accepts IANA names and rejects junk', () => {
  assert.equal(isValidTimeZone('Europe/Amsterdam'), true);
  assert.equal(isValidTimeZone('America/New_York'), true);
  assert.equal(isValidTimeZone('UTC'), true);
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(isValidTimeZone(''), false);
  assert.equal(isValidTimeZone(null), false);
});

// ── timezone-aware "what day is it for you" ──────────────────────────────────

// 2026-07-24T00:30:00Z: already July 24 in Amsterdam (02:30), still July 23 in New York (20:30).
const T_2026_07_24_0030Z = Date.UTC(2026, 6, 24, 0, 30);

test('localDateParts respects the timezone across the date line', () => {
  assert.deepEqual(localDateParts(T_2026_07_24_0030Z, 'Europe/Amsterdam'), { year: 2026, month: 7, day: 24 });
  assert.deepEqual(localDateParts(T_2026_07_24_0030Z, 'America/New_York'), { year: 2026, month: 7, day: 23 });
});

test('the same instant is a birthday in one timezone and not the other', () => {
  const record = { day: 24, month: 7 };
  assert.equal(isBirthdayOn(record, localDateParts(T_2026_07_24_0030Z, 'Europe/Amsterdam')), true);
  assert.equal(isBirthdayOn(record, localDateParts(T_2026_07_24_0030Z, 'America/New_York')), false);
});

// ── Feb 29 rule ──────────────────────────────────────────────────────────────

test('leap-year math', () => {
  assert.equal(isLeapYear(2028), true);
  assert.equal(isLeapYear(2027), false);
  assert.equal(isLeapYear(2000), true);
  assert.equal(isLeapYear(1900), false);
});

test('Feb 29 birthdays celebrate on Feb 29 in leap years, Mar 1 otherwise', () => {
  const leapling = { day: 29, month: 2 };
  assert.equal(isBirthdayOn(leapling, { year: 2028, month: 2, day: 29 }), true);
  assert.equal(isBirthdayOn(leapling, { year: 2028, month: 3, day: 1 }), false, 'leap year: Mar 1 is not the day');
  assert.equal(isBirthdayOn(leapling, { year: 2027, month: 3, day: 1 }), true, 'non-leap: Mar 1 stands in');
  assert.equal(isBirthdayOn(leapling, { year: 2027, month: 2, day: 28 }), false);
});

// ── due / upcoming ───────────────────────────────────────────────────────────

test('dueBirthdays picks only today-in-their-tz, unannounced-this-year users', () => {
  const users = {
    amsterdam: { day: 24, month: 7, timeZone: 'Europe/Amsterdam' },
    newyork: { day: 24, month: 7, timeZone: 'America/New_York' }, // still July 23 there
    done: { day: 24, month: 7, timeZone: 'Europe/Amsterdam', lastAnnouncedYear: 2026 },
    otherday: { day: 1, month: 1, timeZone: 'Europe/Amsterdam' },
    corrupt: { day: 31, month: 2, timeZone: 'Europe/Amsterdam' }, // invalid — skipped
  };
  const due = dueBirthdays(users, T_2026_07_24_0030Z);
  assert.deepEqual(due, [{ userId: 'amsterdam', localYear: 2026 }]);
});

test('daysUntilBirthday counts calendar days in the member timezone', () => {
  const now = T_2026_07_24_0030Z;
  assert.equal(daysUntilBirthday({ day: 24, month: 7, timeZone: 'Europe/Amsterdam' }, now), 0);
  assert.equal(daysUntilBirthday({ day: 25, month: 7, timeZone: 'Europe/Amsterdam' }, now), 1);
  assert.equal(daysUntilBirthday({ day: 24, month: 7, timeZone: 'America/New_York' }, now), 1, 'their July 24 is tomorrow');
  assert.equal(daysUntilBirthday({ day: 23, month: 7, timeZone: 'Europe/Amsterdam' }, now), 364, 'yesterday wraps a year');
});

test('nextBirthdays sorts soonest-first and caps the count', () => {
  const users = {
    today: { day: 24, month: 7, timeZone: 'Europe/Amsterdam' },
    nextweek: { day: 31, month: 7, timeZone: 'Europe/Amsterdam' },
    wrapped: { day: 1, month: 1, timeZone: 'Europe/Amsterdam' },
  };
  const list = nextBirthdays(users, T_2026_07_24_0030Z, 2);
  assert.deepEqual(list.map((x) => x.userId), ['today', 'nextweek']);
  assert.equal(list[0].daysUntil, 0);
});

test('formatBirthday renders day + month name', () => {
  assert.equal(formatBirthday({ day: 24, month: 7 }), '24 July');
  assert.equal(formatBirthday({ day: 29, month: 2 }), '29 February');
});

// ── service + sweep ──────────────────────────────────────────────────────────

function fakeGuild(guildId, { channelWorks = true } = {}) {
  const sends = [];
  const channel = {
    id: 'bday-chan',
    send: async (payload) => {
      if (!channelWorks) throw new Error('no perms');
      sends.push(payload);
      return payload;
    },
  };
  return { id: guildId, channels: { cache: new Map([['bday-chan', channel]]) }, sends };
}

test('set/remove birthday round-trips through the store', () => {
  const guildId = freshGuildId();
  setBirthday(guildId, 'u1', { day: 24, month: 7, timeZone: 'Europe/Amsterdam' });
  assert.equal(getBirthdayUsers(guildId).u1.day, 24);
  assert.equal(removeBirthday(guildId, 'u1'), true);
  assert.equal(removeBirthday(guildId, 'u1'), false, 'second remove reports nothing on file');
  assert.deepEqual(getBirthdayUsers(guildId), {});
});

test('sweep announces once, stamps the year, and never repeats', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  setBirthdayConfig(guildId, { channelId: 'bday-chan' });
  setBirthday(guildId, 'u2', { day: 24, month: 7, timeZone: 'Europe/Amsterdam' });

  assert.equal(await sweepBirthdays(guild, T_2026_07_24_0030Z), 1);
  assert.equal(guild.sends.length, 1);
  assert.match(guild.sends[0].content, /<@u2>/);
  assert.deepEqual(guild.sends[0].allowedMentions, { users: ['u2'] });
  assert.equal(getBirthdayUsers(guildId).u2.lastAnnouncedYear, 2026);

  // Later ticks the same day (and the same year) stay silent.
  assert.equal(await sweepBirthdays(guild, T_2026_07_24_0030Z + 3_600_000), 0);
  assert.equal(guild.sends.length, 1);
  // Next year announces again.
  assert.equal(await sweepBirthdays(guild, Date.UTC(2027, 6, 24, 10, 0)), 1);
});

test('sweep does nothing when disabled or unconfigured, and survives send failures', async () => {
  const guildId = freshGuildId();
  setBirthday(guildId, 'u3', { day: 24, month: 7, timeZone: 'Europe/Amsterdam' });

  // Default channel (the owner's) is absent in this fake guild → silent no-op.
  assert.equal(await sweepBirthdays(fakeGuild(guildId), T_2026_07_24_0030Z), 0);

  // Configured but disabled → silent no-op.
  setBirthdayConfig(guildId, { channelId: 'bday-chan', enabled: false });
  assert.equal(await sweepBirthdays(fakeGuild(guildId), T_2026_07_24_0030Z), 0);

  // Enabled but the send throws → no crash, stamped anyway (no retry pileup).
  setBirthdayConfig(guildId, { enabled: true });
  const broken = fakeGuild(guildId, { channelWorks: false });
  assert.equal(await sweepBirthdays(broken, T_2026_07_24_0030Z), 0);
  assert.equal(getBirthdayUsers(guildId).u3.lastAnnouncedYear, 2026, 'stamp-before-send holds');
});

test('config is sparse and defaults stay live', async () => {
  const guildId = freshGuildId();
  setBirthdayConfig(guildId, { channelId: 'c1' });
  const { getGuildData } = await import('../src/core/store.js');
  assert.deepEqual(Object.keys(getGuildData(guildId, 'birthdayConfig', {})), ['channelId']);
  assert.equal(getBirthdayConfig(guildId).enabled, true);
});

test('defaults encode the owner decision: announcements in their channel (S31)', async () => {
  const { DEFAULT_BIRTHDAY_CONFIG } = await import('../src/modules/birthdays/service.js');
  assert.equal(DEFAULT_BIRTHDAY_CONFIG.enabled, true);
  assert.equal(DEFAULT_BIRTHDAY_CONFIG.channelId, '411609312037961729');
});

test('the default timezone is US Eastern (S32, owner decision)', async () => {
  const { DEFAULT_TIMEZONE } = await import('../src/modules/birthdays/lib/birthday.js');
  assert.equal(DEFAULT_TIMEZONE, 'America/New_York');
  // A record with a junk timezone falls back to Eastern: at 00:30 UTC on
  // July 24 it is still July 23 in New York, so the birthday is NOT due yet.
  const due = dueBirthdays({ u: { day: 24, month: 7, timeZone: 'Mars/Junk' } }, T_2026_07_24_0030Z);
  assert.deepEqual(due, [], 'invalid timezone now falls back to Eastern, not Amsterdam');
});

// ── S44: YYYY/MM/DD input + timezone suggestions ─────────────────────────────

test('parseBirthdayDate accepts YYYY/MM/DD (and - or . separators), fully validated', () => {
  assert.deepEqual(parseBirthdayDate('1990/05/23'), { year: 1990, month: 5, day: 23 });
  assert.deepEqual(parseBirthdayDate('1990-5-3'), { year: 1990, month: 5, day: 3 });
  assert.deepEqual(parseBirthdayDate(' 2000.12.31 '), { year: 2000, month: 12, day: 31 });
  assert.equal(parseBirthdayDate('23/05/1990'), null, 'DD/MM/YYYY is refused — the year leads');
  assert.equal(parseBirthdayDate('1990/13/01'), null);
  assert.equal(parseBirthdayDate('1990/04/31'), null, 'April has 30 days');
  assert.equal(parseBirthdayDate('nonsense'), null);
});

test('parseBirthdayDate knows leap years and bounds the year', () => {
  assert.deepEqual(parseBirthdayDate('2000/02/29'), { year: 2000, month: 2, day: 29 }, '2000 was a leap year');
  assert.equal(parseBirthdayDate('2001/02/29'), null, '2001 was not');
  assert.equal(parseBirthdayDate('1899/01/01'), null, 'pre-1900 refused');
  assert.equal(parseBirthdayDate('2030/01/01', { currentYear: 2026 }), null, 'no future birthdays');
  assert.deepEqual(parseBirthdayDate('2026/01/01', { currentYear: 2026 }), { year: 2026, month: 1, day: 1 });
});

test('suggestTimeZones: US-first on empty query, substring search otherwise, capped at 25', () => {
  const empty = suggestTimeZones('');
  assert.equal(empty[0], 'America/New_York', 'the community default leads');
  assert.ok(empty.includes('Europe/Amsterdam'));
  assert.ok(empty.length <= 25);

  const amsterdam = suggestTimeZones('amster');
  assert.equal(amsterdam[0], 'Europe/Amsterdam');

  const america = suggestTimeZones('america/');
  assert.ok(america.length <= 25);
  assert.ok(america.every((z) => z.toLowerCase().includes('america/')));
  assert.equal(america[0], 'America/New_York', 'prioritized zones outrank alphabetical ones');

  assert.deepEqual(suggestTimeZones('zzzzz-nope'), []);
});

// ── the birthday role (S58) ──────────────────────────────────────────────────

const BDAY_ROLE = '701577807070756946';
const T_NEXT_DAY = Date.UTC(2026, 6, 25, 0, 30); // July 25 in Amsterdam

test('the owner birthday role is the committed default (S58)', async () => {
  const { DEFAULT_BIRTHDAY_CONFIG } = await import('../src/modules/birthdays/service.js');
  assert.equal(DEFAULT_BIRTHDAY_CONFIG.birthdayRoleId, BDAY_ROLE);
});

test('birthdayCelebrants ignores the announce stamp — the role lasts all day', () => {
  const users = { u: { day: 24, month: 7, timeZone: 'Europe/Amsterdam', lastAnnouncedYear: 2026 } };
  assert.deepEqual(birthdayCelebrants(users, T_2026_07_24_0030Z), ['u'], 'announced ≠ done celebrating');
  assert.deepEqual(birthdayCelebrants(users, T_NEXT_DAY), [], 'day over');
});

function fakeRoleGuild(guildId, memberIds, state = { failRemove: false }) {
  const members = new Map();
  const log = { added: [], removed: [] };
  for (const id of memberIds) {
    const held = new Set();
    members.set(id, {
      id,
      held,
      roles: {
        cache: { has: (r) => held.has(r) },
        add: async (r) => {
          held.add(r);
          log.added.push(id);
        },
        remove: async (r) => {
          if (state.failRemove) throw new Error('hierarchy says no');
          held.delete(r);
          log.removed.push(id);
        },
      },
    });
  }
  return {
    id: guildId,
    channels: { cache: new Map() },
    members: {
      fetch: async (id) => {
        const m = members.get(id);
        if (!m) throw new Error('Unknown Member');
        return m;
      },
      map: members,
    },
    log,
  };
}

test('syncBirthdayRole: worn all day, removed the day after, add is idempotent (S58)', async () => {
  const guildId = freshGuildId();
  const guild = fakeRoleGuild(guildId, ['jarige']);
  setBirthday(guildId, 'jarige', { day: 24, month: 7, timeZone: 'Europe/Amsterdam' });

  const first = await syncBirthdayRole(guild, T_2026_07_24_0030Z);
  assert.deepEqual(first, { added: 1, removed: 0 });
  assert.ok(guild.members.map.get('jarige').held.has(BDAY_ROLE));

  // Later ticks the same day: still a celebrant, no duplicate API add.
  const second = await syncBirthdayRole(guild, T_2026_07_24_0030Z + 3_600_000);
  assert.deepEqual(second, { added: 0, removed: 0 });
  assert.equal(guild.log.added.length, 1);

  // The day after: the role comes off and tracking stops.
  const third = await syncBirthdayRole(guild, T_NEXT_DAY);
  assert.deepEqual(third, { added: 0, removed: 1 });
  assert.ok(!guild.members.map.get('jarige').held.has(BDAY_ROLE));
  assert.deepEqual(await syncBirthdayRole(guild, T_NEXT_DAY + 600_000), { added: 0, removed: 0 });
});

test('syncBirthdayRole: a failed removal is retried next tick; manual roles are never stripped (S58)', async () => {
  const guildId = freshGuildId();
  const state = { failRemove: true };
  const guild = fakeRoleGuild(guildId, ['jarige', 'manual'], state);
  setBirthday(guildId, 'jarige', { day: 24, month: 7, timeZone: 'Europe/Amsterdam' });
  guild.members.map.get('manual').held.add(BDAY_ROLE); // given by a human, not by us

  await syncBirthdayRole(guild, T_2026_07_24_0030Z); // grant
  assert.deepEqual(await syncBirthdayRole(guild, T_NEXT_DAY), { added: 0, removed: 0 }, 'blocked removal');
  assert.ok(guild.members.map.get('jarige').held.has(BDAY_ROLE), 'still worn — will retry');

  state.failRemove = false;
  assert.deepEqual(await syncBirthdayRole(guild, T_NEXT_DAY + 600_000), { added: 0, removed: 1 }, 'retried');
  assert.ok(guild.members.map.get('manual').held.has(BDAY_ROLE), 'the manually granted role is untouched');
  assert.equal(guild.log.removed.filter((id) => id === 'manual').length, 0);
});

test('syncBirthdayRole: no-op without a role id; a departed celebrant is skipped (S58)', async () => {
  const guildId = freshGuildId();
  setBirthday(guildId, 'ghost', { day: 24, month: 7, timeZone: 'Europe/Amsterdam' });
  const guild = fakeRoleGuild(guildId, []); // nobody fetchable
  assert.deepEqual(await syncBirthdayRole(guild, T_2026_07_24_0030Z), { added: 0, removed: 0 });

  setBirthdayConfig(guildId, { birthdayRoleId: null }); // /birthday-config no-birthday-role:True
  const guild2 = fakeRoleGuild(guildId, ['ghost']);
  assert.deepEqual(await syncBirthdayRole(guild2, T_2026_07_24_0030Z), { added: 0, removed: 0 });
  assert.equal(guild2.log.added.length, 0);
});

// ── the three commands (converted in S94 = M17.3 slice B) ───────────────────
// None of them had a test before the conversion.

test('!birthday-set stores the date and defaults the timezone', async () => {
  const guildId = freshGuildId();
  const message = fakeMessage({ guildId, authorId: MEMBER });
  assert.equal(await dispatchGroup(birthdayGroup.group, message, ['set', ...['1990/05/23']], '!'), 'ran');
  assert.match(message.sent[0].content, /23 May/);
  const stored = getBirthdayUsers(guildId)[MEMBER];
  assert.deepEqual(
    { day: stored.day, month: stored.month, year: stored.year, timeZone: stored.timeZone },
    { day: 23, month: 5, year: 1990, timeZone: DEFAULT_TIMEZONE },
  );
});

test('!birthday-set takes an explicit timezone, positionally or by keyword', async () => {
  for (const tokens of [['1990/05/23', 'America/Chicago'], ['1990/05/23', 'timezone:America/Chicago']]) {
    const guildId = freshGuildId();
    const message = fakeMessage({ guildId, authorId: MEMBER });
    await dispatchGroup(birthdayGroup.group, message, ['set', ...tokens], '!');
    assert.equal(getBirthdayUsers(guildId)[MEMBER]?.timeZone, 'America/Chicago', tokens.join(' '));
  }
});

test('!birthday-set refuses a bad date and stores nothing', async () => {
  const guildId = freshGuildId();
  const message = fakeMessage({ guildId, authorId: MEMBER });
  await dispatchGroup(birthdayGroup.group, message, ['set', ...['23/05/1990']], '!');
  assert.match(message.sent[0].content, /YYYY\/MM\/DD/);
  assert.equal(getBirthdayUsers(guildId)[MEMBER], undefined);
});

test('!birthday-set suggests real zones for a near-miss (S94, replacing autocomplete)', async () => {
  const guildId = freshGuildId();
  const message = fakeMessage({ guildId, authorId: MEMBER });
  await dispatchGroup(birthdayGroup.group, message, ['set', ...['1990/05/23', 'Europe/Amster']], '!');
  assert.match(message.sent[0].content, /not a timezone I know/);
  assert.match(message.sent[0].content, /Europe\/Amsterdam/);
});

test('!birthday-remove reports whether there was anything to remove', async () => {
  const guildId = freshGuildId();
  const empty = fakeMessage({ guildId, authorId: MEMBER });
  await dispatchGroup(birthdayGroup.group, empty, ['remove', ...[]], '!');
  assert.match(empty.sent[0].content, /no birthday on file/i);

  await dispatchGroup(birthdayGroup.group, fakeMessage({ guildId, authorId: MEMBER }), ['set', ...['1990/05/23']], '!');
  const filled = fakeMessage({ guildId, authorId: MEMBER });
  await dispatchGroup(birthdayGroup.group, filled, ['remove', ...[]], '!');
  assert.match(filled.sent[0].content, /struck from the record/i);
  assert.equal(getBirthdayUsers(guildId)[MEMBER], undefined);
});

test('!birthdays lists upcoming birthdays and honours the count bounds', async () => {
  const guildId = freshGuildId();
  await dispatchGroup(birthdayGroup.group, fakeMessage({ guildId, authorId: MEMBER }), ['set', ...['1990/05/23']], '!');

  const listed = fakeMessage({ guildId, authorId: MEMBER });
  await dispatchCommand(birthdaysList.command, listed, [], '!');
  assert.match(listed.sent[0].embeds[0].data.description, new RegExp(`<@${MEMBER}>`));

  const tooMany = fakeMessage({ guildId, authorId: MEMBER });
  assert.equal(await dispatchCommand(birthdaysList.command, tooMany, ['99'], '!'), 'usage-error');
  assert.match(tooMany.sent[0].content, /between 1 and 15/);
});

test('!birthdays says so when nobody is on file', async () => {
  const message = fakeMessage({ guildId: freshGuildId(), authorId: MEMBER });
  await dispatchCommand(birthdaysList.command, message, [], '!');
  assert.match(message.sent[0].embeds[0].data.description, /No birthdays on file yet/);
});
