// Discord timestamp markup (S134, owner: "Times in discord relative time").
//
// `<t:1753632000:R>` renders as "in 45 minutes" — in the READER's timezone,
// counting down live without the bot editing the message. A hand-formatted
// "45m 00s" is stale the second it is sent, and a hand-formatted clock time is
// in whatever zone the bot's host happens to sit in (the Pi is UTC; the owner
// is not).
//
// ⚠️ **Discord does not render this markup everywhere.** It resolves in
// message content, embed descriptions and embed field values — and is printed
// as the literal string `<t:1753632000:R>` in:
//
//   - select-menu option labels AND descriptions
//   - button labels
//   - embed titles, footers and author names
//
// So a countdown that appears both in an embed line and in a select option
// needs BOTH forms: the timestamp for the embed, a plain duration for the
// option. `test/timestamps.test.js` walks every panel in the repo and fails if
// a `<t:` token reaches a place that cannot render it.
//
// Durations are NOT moments. "cooldown 6h", "each turn gives 5 seconds",
// "checks every 15 minutes" describe how LONG something lasts, not WHEN it
// happens, and a relative timestamp there would be wrong rather than nicer.
// Those keep their plain formatting on purpose.

/** Every style Discord accepts, so a caller never invents a letter. */
export const TIME_STYLES = {
  shortTime: 't', // 14:32
  longTime: 'T', // 14:32:05
  shortDate: 'd', // 27/07/2026
  longDate: 'D', // 27 July 2026
  shortDateTime: 'f', // 27 July 2026 14:32
  longDateTime: 'F', // Monday, 27 July 2026 14:32
  relative: 'R', // in 45 minutes
};

/**
 * `<t:unix:style>` from a millisecond epoch.
 *
 * Discord wants SECONDS; passing milliseconds yields a date in the year 57000,
 * which renders happily and is wrong — so the conversion lives here once
 * rather than at each of the call sites that used to hand-roll it.
 *
 * @param {number} ms     epoch milliseconds
 * @param {string} style  one of TIME_STYLES' values (default relative)
 */
export function discordTime(ms, style = TIME_STYLES.relative) {
  return `<t:${Math.floor(Number(ms) / 1000)}:${style}>`;
}

/** "in 45 minutes" / "3 weeks ago" — the common case. */
export const relative = (ms) => discordTime(ms, TIME_STYLES.relative);

/** "14:32" in the reader's own timezone — for logs, where every line is "now". */
export const clockTime = (ms) => discordTime(ms, TIME_STYLES.shortTime);

/**
 * The same moment as a countdown from now.
 *
 * Pure libs know how much time is LEFT (`remainingMs`), not when the clock
 * strikes; this turns the one into the other so a panel builder does not have
 * to reach for `Date.now()` mid-render and become untestable.
 */
export const relativeIn = (remainingMs, now = Date.now()) => relative(now + Number(remainingMs));
