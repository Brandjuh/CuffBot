import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  daysUntilBirthday,
  dueBirthdays,
  formatBirthday,
  isBirthdayOn,
  isLeapYear,
  isValidBirthday,
  isValidTimeZone,
  localDateParts,
  nextBirthdays,
} from '../src/modules/birthdays/lib/birthday.js';
import {
  getBirthdayConfig,
  getBirthdayUsers,
  removeBirthday,
  setBirthday,
  setBirthdayConfig,
  sweepBirthdays,
} from '../src/modules/birthdays/service.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-birthdays-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `70000000000000${String((seq += 1)).padStart(4, '0')}`;

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

  // No channel configured → silent no-op.
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
