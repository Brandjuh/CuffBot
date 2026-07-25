// Hammertime phrase parsing (S84): the cog's dateutil/fuzzy stack replaced by
// hand-rolled parsers with the SAME observable behavior for its documented
// phrases — the relative regex ported verbatim, cumulative wall-clock deltas,
// calendar-safe months, and a simplified fuzzy absolute parser (weekdays,
// month names, M/D dates, clock times; unknown words are skipped like
// dateutil's fuzzy=True). All functions take an explicit `nowMs`.
import {
  MONTHS,
  WEEKDAYS,
  addMonthsParts,
  addWallMs,
  epochToZonedParts,
  zonedPartsToEpoch,
} from './time.js';

// The cog's RE_RELATIVE_TIME, ported: "1 hour", "an hour ago", "2 wks"…
export const RE_RELATIVE_TIME = /(\d+|an?)\s?(y(?:ea)?rs?|months?|weeks?|days?|h(?:ou)?rs?|min(?:ute)?s?|sec(?:ond)?s?)( ago)?/g;
// The cog's auto-mode gates.
export const RE_AT_IN = /(\s|^)(at|in)\s\d/;
export const RE_AT = /(\s|^)at\s(\d{1,2}:?\d{0,2})\s?(am|pm)?(?=\W|$)/g;

const UNIT_MS = {
  weeks: 7 * 86_400_000,
  days: 86_400_000,
  hours: 3_600_000,
  minutes: 60_000,
  seconds: 1000,
};

function unitOf(period) {
  if (period.startsWith('month')) return 'months';
  return { y: 'years', w: 'weeks', d: 'days', h: 'hours', m: 'minutes', s: 'seconds' }[period[0]];
}

/**
 * The cog's parse_delta: 'now' (word, not 'not now') → now; otherwise the
 * relative matches applied cumulatively IN ORDER with wall-clock semantics
 * (months/years via add_months, the rest as plain time on the wall clock).
 * @returns {number|null} epoch ms, or null (the cog's ParserError)
 */
export function parseDelta(text, timeZone, nowMs) {
  const lower = text.toLowerCase().trim();
  if (!lower.includes('not now') && lower.split(' ').includes('now')) return nowMs;

  const matches = [...lower.matchAll(RE_RELATIVE_TIME)];
  if (matches.length === 0) return null;

  let parts = epochToZonedParts(nowMs, timeZone);
  for (const match of matches) {
    const [, amtRaw, period, past] = match;
    let amt = /^\d+$/.test(amtRaw) ? Number.parseInt(amtRaw, 10) : 1; // 'a'/'an' = 1
    if (past === ' ago') amt = -amt;
    const unit = unitOf(period);
    if (unit === 'months' || unit === 'years') {
      parts = addMonthsParts(parts, amt * (unit === 'years' ? 12 : 1));
    } else {
      parts = addWallMs(parts, amt * UNIT_MS[unit]);
    }
  }
  return zonedPartsToEpoch(parts, timeZone);
}

const MONTH_INDEX = new Map();
MONTHS.forEach((name, i) => {
  MONTH_INDEX.set(name, i + 1);
  MONTH_INDEX.set(name.slice(0, 3), i + 1);
});
const WEEKDAY_INDEX = new Map();
WEEKDAYS.forEach((name, i) => {
  WEEKDAY_INDEX.set(name, i);
  WEEKDAY_INDEX.set(name.slice(0, 3), i);
});

const RE_TIME_TOKEN = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/;
const RE_NUMERIC_DATE = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/;
const RE_ISO_DATE = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const RE_DAY_NUMBER = /^(\d{1,2})(?:st|nd|rd|th)?$/;

/**
 * The cog's parse_datetime, hand-rolled (its dateutil fuzzy=True call with
 * today's date prefixed): today/tomorrow/yesterday, a weekday name (next
 * occurrence, today included — dateutil's resolution), "jan 5"/"5 jan",
 * numeric M/D[/Y] (US order, like dateutil's default), ISO Y-M-D, and a
 * clock time H[:MM][am|pm] (a bare trailing number becomes the hour, like
 * fuzzy dateutil). Unknown words are skipped. Missing time = midnight.
 * DEVIATION (recorded): a phrase with NO recognizable date or time token
 * returns null — the cog's fuzzy parse silently answered "today 00:00".
 * @returns {number|null} epoch ms
 */
export function parseAbsolute(text, timeZone, nowMs) {
  const today = epochToZonedParts(nowMs, timeZone);
  const tokens = text
    .toLowerCase()
    .replaceAll(',', ' ')
    .split(/\s+/)
    .filter(Boolean);

  let date = null; // {year, month, day}
  let time = null; // {hour, minute}
  let ampm = null;
  let sawDateWord = false;
  let pendingMonth = null;
  let bareNumber = null;

  const dayFromToday = (offset) => {
    const moved = addWallMs({ ...today, hour: 0, minute: 0, second: 0 }, offset * 86_400_000);
    return { year: moved.year, month: moved.month, day: moved.day };
  };

  for (const token of tokens) {
    if (token === 'today') { date = dayFromToday(0); sawDateWord = true; continue; }
    if (token === 'tomorrow') { date = dayFromToday(1); sawDateWord = true; continue; }
    if (token === 'yesterday') { date = dayFromToday(-1); sawDateWord = true; continue; }
    if (WEEKDAY_INDEX.has(token)) {
      // dateutil: the next such weekday, today included.
      const ahead = (WEEKDAY_INDEX.get(token) - today.dow + 7) % 7;
      date = dayFromToday(ahead);
      sawDateWord = true;
      continue;
    }
    if (MONTH_INDEX.has(token)) {
      pendingMonth = MONTH_INDEX.get(token);
      // A number just before the month name was its day ("5 jan").
      if (bareNumber !== null && bareNumber >= 1 && bareNumber <= 31) {
        date = { year: today.year, month: pendingMonth, day: bareNumber };
        sawDateWord = true;
        pendingMonth = null;
        bareNumber = null;
        if (time?.fromBare) time = null; // that number was a day, not an hour
      }
      continue;
    }
    const iso = RE_ISO_DATE.exec(token);
    if (iso) {
      date = { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
      sawDateWord = true;
      continue;
    }
    const numeric = RE_NUMERIC_DATE.exec(token);
    if (numeric) {
      let year = numeric[3] ? Number(numeric[3]) : today.year;
      if (year < 100) year += 2000;
      date = { year, month: Number(numeric[1]), day: Number(numeric[2]) };
      sawDateWord = true;
      continue;
    }
    if (pendingMonth !== null) {
      const dayMatch = RE_DAY_NUMBER.exec(token);
      if (dayMatch) {
        // "jan 5" / "jan 5th" — the number after a month name is its day.
        date = { year: today.year, month: pendingMonth, day: Number(dayMatch[1]) };
        sawDateWord = true;
        pendingMonth = null;
        continue;
      }
    }
    const clock = RE_TIME_TOKEN.exec(token);
    if (clock) {
      const value = Number(clock[1]);
      if (clock[2] || clock[3]) {
        time = { hour: value, minute: clock[2] ? Number(clock[2]) : 0 };
        ampm = clock[3] ?? ampm;
      } else if (time === null) {
        // A bare number reads as the hour (fuzzy dateutil: "at 6" → 06:00) —
        // unless a following month name claims it as a day.
        time = { hour: value, minute: 0, fromBare: true };
        bareNumber = value;
      }
      continue;
    }
    if (token === 'am' || token === 'pm') { ampm = token; continue; }
    // Anything else (at, on, names…) is skipped — dateutil fuzzy behavior.
  }

  if (!sawDateWord && time === null) return null;

  let hour = time?.hour ?? 0;
  const minute = time?.minute ?? 0;
  if (time && hour <= 12 && ampm) {
    if (ampm === 'pm' && hour !== 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
  }
  if (hour > 23 || minute > 59) return null;

  const target = date ?? dayFromToday(0);
  return zonedPartsToEpoch({ ...target, hour, minute, second: 0 }, timeZone);
}

/**
 * The cog's get_datetime_for order: relative first, absolute second.
 * @returns {{epochMs:number, kind:'delta'|'datetime'}|null}
 */
export function parsePhrase(text, timeZone, nowMs) {
  const delta = parseDelta(text, timeZone, nowMs);
  if (delta !== null) return { epochMs: delta, kind: 'delta' };
  const absolute = parseAbsolute(text, timeZone, nowMs);
  if (absolute !== null) return { epochMs: absolute, kind: 'datetime' };
  return null;
}

/**
 * The cog's auto-mode am/pm inference for a bare "at H[:MM]": default pm;
 * for hour ≤ 12 take the CURRENT half of the day, flipped when the hour has
 * already passed in that half (quirky, ported as-is).
 */
export function inferAmPm(hour, timeZone, nowMs) {
  if (hour > 12) return 'pm';
  const now = epochToZonedParts(nowMs, timeZone);
  let ampm = now.hour < 12 ? 'am' : 'pm';
  const nowHour12 = now.hour % 12 === 0 ? 12 : now.hour % 12;
  if (hour < nowHour12) ampm = ampm === 'am' ? 'pm' : 'am';
  return ampm;
}

/**
 * The cog's on_message pipeline after the at/in gate: relative parse first;
 * else exactly ONE "at H[:MM]" (two or more → silence), am/pm inferred when
 * absent, then the absolute parse.
 * @returns {number|null} epoch ms
 */
export function parseAutoMessage(content, timeZone, nowMs) {
  const lower = content.toLowerCase();
  if (!RE_AT_IN.test(lower)) return null;
  const delta = parseDelta(lower, timeZone, nowMs);
  if (delta !== null) return delta;

  const matches = [...lower.matchAll(RE_AT)];
  if (matches.length !== 1) return null;
  const [, , timeRaw, ampmRaw] = matches[0];
  let text = lower;
  if (!ampmRaw) {
    const hour = Number.parseInt(timeRaw.includes(':') ? timeRaw.split(':')[0] : timeRaw, 10);
    text = lower.replace(timeRaw, `${timeRaw} ${inferAmPm(hour, timeZone, nowMs)}`);
  }
  return parseAbsolute(text, timeZone, nowMs);
}
