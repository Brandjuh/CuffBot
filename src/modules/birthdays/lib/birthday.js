// Pure birthday math — no discord.js, no store, no timers. Everything takes
// `now` (a ms timestamp) and works in the MEMBER's own IANA timezone via Intl,
// so "your birthday" starts at YOUR midnight, not the server's. Node ships
// full-icu since v13, so every IANA zone resolves on the Pi and in tests.

export const DAYS_IN_MONTH = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// Owner decision 2026-07-24 (S32): the community is US-based — default to the
// most-populated US timezone, Eastern Time. Members elsewhere pass timezone:.
export const DEFAULT_TIMEZONE = 'America/New_York';

/** A calendar-valid day/month pair (Feb 29 is allowed — see feb29Rule). */
export function isValidBirthday(day, month) {
  if (!Number.isInteger(day) || !Number.isInteger(month)) return false;
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= DAYS_IN_MONTH[month - 1];
}

/**
 * Parse the S44 owner-mandated input format `YYYY/MM/DD` (also tolerating
 * `-` and `.` separators). Fully validated against the REAL calendar — with
 * the year known, Feb 29 is only accepted in actual leap years. Years are
 * bounded to [1900, currentYear].
 * @returns {{year:number, month:number, day:number}|null}
 */
export function parseBirthdayDate(input, { currentYear = new Date().getUTCFullYear() } = {}) {
  const match = String(input ?? '')
    .trim()
    .match(/^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1900 || year > currentYear) return null;
  if (month < 1 || month > 12) return null;
  const maxDay = month === 2 && !isLeapYear(year) ? 28 : DAYS_IN_MONTH[month - 1];
  if (day < 1 || day > maxDay) return null;
  return { year, month, day };
}

// Shown first in the timezone picker when nothing is typed yet — the
// community is US-based (S32), Amsterdam covers the owner.
const PRIORITY_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'Europe/Amsterdam',
  'Europe/London',
  'Europe/Berlin',
];

/**
 * Timezone suggestions for the autocomplete picker (S44): empty query shows
 * the common zones, anything typed substring-filters the FULL IANA list
 * (prioritized zones first). Discord shows at most 25 suggestions.
 */
export function suggestTimeZones(query, limit = 25) {
  const all = Intl.supportedValuesOf?.('timeZone') ?? [];
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return PRIORITY_TIMEZONES.filter((z) => all.includes(z)).slice(0, limit);
  const priority = PRIORITY_TIMEZONES.filter((z) => all.includes(z) && z.toLowerCase().includes(q));
  const rest = all.filter((z) => z.toLowerCase().includes(q) && !priority.includes(z));
  return [...priority, ...rest].slice(0, limit);
}

/** Does Intl know this IANA timezone name? */
export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || tz.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The {year, month, day} it currently is in the given timezone. */
export function localDateParts(now, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(now));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Is this record's birthday "today" for the given local date? Feb 29 birthdays
 * are celebrated on Feb 29 in leap years and on Mar 1 otherwise — nobody
 * skips three years of donuts.
 */
export function isBirthdayOn(record, local) {
  if (record.month === 2 && record.day === 29 && !isLeapYear(local.year)) {
    return local.month === 3 && local.day === 1;
  }
  return local.month === record.month && local.day === record.day;
}

/**
 * All users whose birthday is today (in their own timezone) and who have not
 * been announced yet this local year.
 * @param {Record<string, {day:number, month:number, timeZone:string, lastAnnouncedYear?:number}>} users
 * @returns {Array<{userId:string, localYear:number}>}
 */
export function dueBirthdays(users, now) {
  const due = [];
  for (const [userId, record] of Object.entries(users ?? {})) {
    if (!isValidBirthday(record.day, record.month)) continue;
    const tz = isValidTimeZone(record.timeZone) ? record.timeZone : DEFAULT_TIMEZONE;
    const local = localDateParts(now, tz);
    if (isBirthdayOn(record, local) && record.lastAnnouncedYear !== local.year) {
      due.push({ userId, localYear: local.year });
    }
  }
  return due;
}

/**
 * Days until the next occurrence of this birthday, measured in the member's
 * own timezone (0 = today). Calendar-day arithmetic on the local date — DST
 * shifts can't skew it.
 */
export function daysUntilBirthday(record, now) {
  const tz = isValidTimeZone(record.timeZone) ? record.timeZone : DEFAULT_TIMEZONE;
  const local = localDateParts(now, tz);
  if (isBirthdayOn(record, local)) return 0;

  const toDayNumber = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
  const today = toDayNumber(local.year, local.month, local.day);
  for (const year of [local.year, local.year + 1]) {
    // Feb 29 in a non-leap year resolves to Mar 1 (same rule as announcing).
    const real =
      record.month === 2 && record.day === 29 && !isLeapYear(year)
        ? { month: 3, day: 1 }
        : { month: record.month, day: record.day };
    const candidate = toDayNumber(year, real.month, real.day);
    if (candidate > today) return candidate - today;
  }
  return 366; // unreachable, but a sane ceiling
}

/**
 * Upcoming birthdays, soonest first: [{userId, record, daysUntil}].
 * Today's birthdays sort first (daysUntil 0).
 */
export function nextBirthdays(users, now, count = 5) {
  return Object.entries(users ?? {})
    .filter(([, r]) => isValidBirthday(r.day, r.month))
    .map(([userId, record]) => ({ userId, record, daysUntil: daysUntilBirthday(record, now) }))
    .sort((a, b) => a.daysUntil - b.daysUntil || a.userId.localeCompare(b.userId))
    .slice(0, Math.max(1, count));
}

/** "24 July" — how a stored birthday reads in messages (no year: none is stored). */
export function formatBirthday(record) {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${record.day} ${MONTHS[record.month - 1] ?? '?'}`;
}
