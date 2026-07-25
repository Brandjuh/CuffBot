// Hammertime pure time math (S84 = M16.11, ported from Dumb-Cogs/hammertime):
// zone-aware wall-clock conversions via Intl (replacing pytz/dateutil), the
// cog's calendar-safe month arithmetic, and its exact display format. No
// discord.js imports; every function takes explicit instants — no Date.now.

export const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const partFormatters = new Map();

function formatterFor(timeZone) {
  let formatter = partFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      weekday: 'short',
    });
    partFormatters.set(timeZone, formatter);
  }
  return formatter;
}

const SHORT_DOW = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** The wall clock in `timeZone` at the given instant.
 * @returns {{year:number, month:number, day:number, hour:number, minute:number, second:number, dow:number}} month 1–12, dow 0=Sunday */
export function epochToZonedParts(epochMs, timeZone) {
  const parts = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(new Date(epochMs))) {
    if (type === 'weekday') parts.dow = SHORT_DOW[value];
    else if (type !== 'literal') parts[type] = Number(value);
  }
  // hourCycle h23 still reports 24 for midnight on some ICU versions.
  if (parts.hour === 24) parts.hour = 0;
  return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second, dow: parts.dow };
}

const asUtc = (p) => Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second ?? 0);

/**
 * The instant whose wall clock in `timeZone` reads `parts` — the iterative
 * inverse of epochToZonedParts (two refinement steps cover DST edges; a
 * skipped/ambiguous wall time resolves to a nearby valid instant, matching
 * the lenient dateutil behavior the cog relied on).
 */
export function zonedPartsToEpoch(parts, timeZone) {
  let guess = asUtc(parts);
  for (let i = 0; i < 2; i += 1) {
    guess += asUtc(parts) - asUtc(epochToZonedParts(guess, timeZone));
  }
  return guess;
}

/** The zone's UTC offset in minutes at the given instant (east positive). */
export function offsetMinutesAt(epochMs, timeZone) {
  return Math.round((asUtc(epochToZonedParts(epochMs, timeZone)) - epochMs) / 60_000);
}

/** The cog's add_months: calendar-safe — the day clamps to the target
 * month's length (Jan 31 + 1 month = Feb 28/29). Pure on wall parts. */
export function addMonthsParts(parts, months) {
  const zeroBased = parts.month - 1 + months;
  const year = parts.year + Math.floor(zeroBased / 12);
  const month = ((zeroBased % 12) + 12) % 12 + 1;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { ...parts, year, month, day: Math.min(parts.day, daysInMonth) };
}

/** Wall-clock addition of a plain-time delta (the cog's aware + timedelta:
 * the WALL time moves by the delta, the offset renormalizes afterwards). */
export function addWallMs(parts, deltaMs) {
  const moved = new Date(asUtc(parts) + deltaMs);
  return {
    year: moved.getUTCFullYear(),
    month: moved.getUTCMonth() + 1,
    day: moved.getUTCDate(),
    hour: moved.getUTCHours(),
    minute: moved.getUTCMinutes(),
    second: moved.getUTCSeconds(),
    dow: moved.getUTCDay(),
  };
}

/** The cog's ordinal suffix. */
export function th(n) {
  const mod100 = n % 100;
  if (mod100 >= 4 && mod100 <= 20) return 'th';
  return { 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th';
}

/** The cog's DT_FMT "%A, %b %-d{th} at %-I:%M %p" for an instant in a zone —
 * e.g. "Saturday, Jul 25th at 6:30 PM". */
export function formatUsersTime(epochMs, timeZone) {
  const p = epochToZonedParts(epochMs, timeZone);
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  const ampm = p.hour < 12 ? 'AM' : 'PM';
  return `${WEEKDAYS_LONG[p.dow]}, ${MONTHS_SHORT[p.month - 1]} ${p.day}${th(p.day)} at ${hour12}:${String(p.minute).padStart(2, '0')} ${ampm}`;
}

/** Is this a zone name Intl accepts? (Boot-cheap validity probe.) */
export function isValidTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}
