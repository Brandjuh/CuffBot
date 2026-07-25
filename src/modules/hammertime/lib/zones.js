// Hammertime timezone lookup (S84): the cog's pytz abbreviation/city map
// rebuilt on Intl.supportedValuesOf. Keys per zone: the full name (lowered),
// every city segment after the first slash, and the CURRENT short name
// (EST, CEST, GMT+2…) — the cog also indexed decades of historical
// abbreviations from pytz transition tables; Intl only exposes the present
// (simplified, recorded deviation). Numeric queries (utc+2, gmt-5, +5:30)
// match zones by their CURRENT offset.
import { isValidTimeZone, offsetMinutesAt } from './time.js';

let cache = null;

function shortNameOf(zone, epochMs) {
  try {
    const formatted = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' })
      .formatToParts(new Date(epochMs))
      .find((part) => part.type === 'timeZoneName');
    return formatted?.value ?? null;
  } catch {
    return null;
  }
}

/** zone → map entries; built once (offsets/abbreviations sampled "now" —
 * fine for lookup, conversions always use the real zone rules). */
export function buildTimezoneMap(nowMs = Date.now()) {
  if (cache) return cache;
  const map = new Map(); // key (lowercased) → Set of zone names
  const offsets = new Map(); // zone → current offset minutes
  const add = (key, zone) => {
    const lower = key.toLowerCase();
    if (!map.has(lower)) map.set(lower, new Set());
    map.get(lower).add(zone);
  };
  for (const zone of Intl.supportedValuesOf('timeZone')) {
    add(zone, zone);
    const segments = zone.toLowerCase().split('/');
    for (const segment of segments.slice(1)) add(segment, zone);
    const short = shortNameOf(zone, nowMs);
    if (short) add(short, zone);
    offsets.set(zone, offsetMinutesAt(nowMs, zone));
  }
  cache = { map, offsets };
  return cache;
}

const RE_OFFSET = /^(?:utc|gmt)?\s*([+-])?\s*(\d{1,2})(?::?(\d{2}))?$/;

/**
 * All zones matching a user query — a name, a city, a current abbreviation,
 * or a numeric offset. Sorted; empty array = not a valid timezone.
 */
export function lookupTimezones(query, nowMs = Date.now()) {
  const { map, offsets } = buildTimezoneMap(nowMs);
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase().replaceAll(' ', '_');
  if (map.has(lower)) return [...map.get(lower)].sort();
  // Aliases Intl accepts but supportedValuesOf omits (US/Eastern, Etc/GMT-2…).
  if (/[a-z]/i.test(trimmed) && isValidTimeZone(trimmed)) return [trimmed];

  const offset = RE_OFFSET.exec(query.toLowerCase().trim());
  if (offset) {
    const sign = offset[1] === '-' ? -1 : 1;
    const minutes = sign * (Number(offset[2]) * 60 + Number(offset[3] ?? 0));
    return [...offsets.entries()]
      .filter(([, zoneOffset]) => zoneOffset === minutes)
      .map(([zone]) => zone)
      .sort();
  }
  return [];
}
