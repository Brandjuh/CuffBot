// The crime narration script (S124 = M26.3b).
//
// S122 gave the crime a panel and a Bail Out button, but the attempt still
// settled in one call two seconds later — so the button existed for one beat
// and the drawn events only ever appeared in the result card, after they could
// no longer matter. The source plays them out: it posts each event, waits, and
// **re-checks the bail flag between every one**, so "a guard walks past
// (-15%)" is information you get while you can still walk away. That is what
// makes Bail Out a decision instead of a coin flip on a timer.
//
// Pure: events in, a list of beats out. No Discord, no timers, no clock — the
// caller owns the waiting, which is also why a test can play a whole crime in
// zero milliseconds.
import { ATTEMPT_WINDOW_MS } from './panel.js';
import { EVENT_CHANCES } from './tables.js';

/** The cog's `asyncio.sleep(2)` after the attempt message goes up. */
export const OPENING_BEAT_MS = 2_000;
/** The cog's `asyncio.sleep(4.0)` between narrated events. */
export const EVENT_BEAT_MS = 4_000;
/** The cog's risk-scaled pause before the verdict. */
export const SUSPENSE_MS = { low: 4_000, medium: 5_000, high: 6_000 };
/** A scenario crime has no risk tier of its own; the cog falls through to 4 s. */
export const DEFAULT_SUSPENSE_MS = SUSPENSE_MS.low;

/** How long the suspense beat runs for a crime of this risk. */
export const suspenseFor = (risk) => SUSPENSE_MS[risk] ?? DEFAULT_SUSPENSE_MS;

/**
 * One event's line, with the data file's placeholders filled in.
 *
 * The texts ship with `{credits_bonus}`, `{credits_penalty}` and `{currency}`
 * because the cog formats them at send time; leaving one unsubstituted prints
 * a literal brace at the player.
 */
export function formatEventText(event, currency = '🍩') {
  return event.text
    .replaceAll('{credits_bonus}', String(event.credits_bonus ?? 0))
    .replaceAll('{credits_penalty}', String(event.credits_penalty ?? 0))
    .replaceAll('{currency}', currency);
}

/**
 * The beats of one attempt, in order.
 *
 * Each beat says what to show and how long to wait **after** showing it. The
 * bail flag is checked before every beat, which is the whole point: the number
 * of chances to bail is the number of beats, not one.
 *
 * @param {Array<object>} events  what `drawEvents` returned
 * @param {string} risk           the crime's risk tier
 * @returns {Array<{kind:'opening'|'event'|'suspense', text?:string, event?:object, delayMs:number}>}
 */
export function crimeScript(events, risk, currency = '🍩') {
  const beats = [{ kind: 'opening', delayMs: OPENING_BEAT_MS }];
  for (const event of events) {
    beats.push({ kind: 'event', event, text: formatEventText(event, currency), delayMs: EVENT_BEAT_MS });
  }
  beats.push({ kind: 'suspense', delayMs: suspenseFor(risk) });
  return beats;
}

/** Total wall-clock the script asks the caller to wait. */
export const scriptDurationMs = (script) => script.reduce((sum, beat) => sum + beat.delayMs, 0);

/**
 * The longest a crime can possibly take: every event the draw can yield, plus
 * the slowest suspense.
 *
 * This exists to be compared against `ATTEMPT_WINDOW_MS`. If a script can
 * outlast the button's own lifetime, the last beats are narrated under a dead
 * Bail Out — the player is shown a decision they can no longer make. The test
 * that asserts it is not decoration: adding one more entry to `EVENT_CHANCES`
 * or raising `EVENT_BEAT_MS` breaks the invariant silently otherwise.
 */
export function worstCaseDurationMs() {
  return (
    OPENING_BEAT_MS + EVENT_CHANCES.length * EVENT_BEAT_MS + Math.max(...Object.values(SUSPENSE_MS))
  );
}

/** Does the slowest possible crime still fit inside the bail window? */
export const scriptFitsBailWindow = () => worstCaseDurationMs() <= ATTEMPT_WINDOW_MS;

/**
 * What the attempt message reads like once `played` beats have been shown.
 *
 * The story accumulates in ONE message rather than the cog's separate-message-
 * per-event (which it then deletes): the Bail Out button lives on that message,
 * so keeping the narration there means the button is always directly under the
 * latest thing that happened.
 *
 * @param {Array} script
 * @param {number} played   how many beats have been shown (1 = just the opening)
 * @param {object} opts
 */
export function storyLines(script, played, { userId, crimeType, bailCost, currency = '🍩' } = {}) {
  const shown = script.slice(0, Math.max(0, played));
  const lines = [`<@${userId}> is running the ${String(crimeType).replaceAll('_', ' ')}…`];

  const events = shown.filter((beat) => beat.kind === 'event');
  if (events.length > 0) lines.push('', ...events.map((beat) => `• ${beat.text}`));

  const last = shown.at(-1);
  if (last?.kind === 'suspense') lines.push('', '_This is it…_');

  lines.push(
    '',
    `-# Second thoughts? **Bail Out** costs ${bailCost} ${currency} and burns the cooldown, but you walk away clean.`,
  );
  return lines;
}
