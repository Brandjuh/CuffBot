// Pure duration parsing/formatting for detainment — no discord.js imports.

const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
const UNIT_NAMES = { d: 'day', h: 'hour', m: 'minute', s: 'second' };

/** Discord's hard cap on timeouts: 28 days. */
export const MAX_TIMEOUT_MS = 28 * UNIT_MS.d;

/**
 * Parse a human duration like "10m", "2h", "7d", "90s", or compounds like
 * "1h30m". Whitespace and case are tolerated ("1H 30M"). Returns milliseconds,
 * or null when the input is not a duration (callers turn that into a specific
 * reply, never a silent default — a mis-parsed detainment is a moderation
 * accident).
 * @param {string} input
 * @returns {number | null}
 */
export function parseDuration(input) {
  if (typeof input !== 'string') return null;
  const compact = input.toLowerCase().replace(/\s+/g, '');
  if (!/^(\d+[smhd])+$/.test(compact)) return null;
  let total = 0;
  for (const [, amount, unit] of compact.matchAll(/(\d+)([smhd])/g)) {
    total += Number(amount) * UNIT_MS[unit];
  }
  return total > 0 ? total : null;
}

/**
 * Human-readable rendering of a millisecond duration: "2 hours 30 minutes".
 * Largest units first, zero units skipped, seconds only when they matter.
 * @param {number} ms
 * @returns {string}
 */
export function formatDuration(ms) {
  let rest = Math.max(0, Math.round(ms / 1000)); // work in whole seconds
  const parts = [];
  for (const [unit, name] of [['d', 'day'], ['h', 'hour'], ['m', 'minute'], ['s', 'second']]) {
    const size = UNIT_MS[unit] / 1000;
    const count = Math.floor(rest / size);
    rest -= count * size;
    if (count > 0) parts.push(`${count} ${name}${count === 1 ? '' : 's'}`);
  }
  return parts.length > 0 ? parts.join(' ') : '0 seconds';
}
