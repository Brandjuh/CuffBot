// M26.3b: the crime plays out beat by beat, with a bail check between each.
//
// S122 shipped the Bail Out button with a single 2-second window because the
// resolver drew its events and settled in one call. These tests pin the thing
// that makes the button a decision: the events are narrated one at a time, so
// the player learns "a guard walks past (-15%)" WHILE they can still walk away.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SUSPENSE_MS,
  EVENT_BEAT_MS,
  OPENING_BEAT_MS,
  SUSPENSE_MS,
  crimeScript,
  formatEventText,
  scriptDurationMs,
  scriptFitsBailWindow,
  storyLines,
  suspenseFor,
  worstCaseDurationMs,
} from '../src/modules/city/lib/narrate.js';
import { ATTEMPT_WINDOW_MS } from '../src/modules/city/lib/panel.js';
import { EVENT_CHANCES, crimeEvents } from '../src/modules/city/lib/tables.js';

const ev = (text, extra = {}) => ({ text, ...extra });

// ── the script ───────────────────────────────────────────────────────────────

test('a script is one opening beat, one beat per event, and one for the verdict', () => {
  const script = crimeScript([ev('a'), ev('b')], 'low');
  assert.deepEqual(script.map((b) => b.kind), ['opening', 'event', 'event', 'suspense']);
  assert.deepEqual(script.map((b) => b.delayMs), [OPENING_BEAT_MS, EVENT_BEAT_MS, EVENT_BEAT_MS, SUSPENSE_MS.low]);
});

test('a crime with no events still has an opening and a verdict', () => {
  // The scenario crime draws no events of its own — it must not produce an
  // empty script, or the attempt would resolve with no pause at all.
  const script = crimeScript([], 'random');
  assert.deepEqual(script.map((b) => b.kind), ['opening', 'suspense']);
  assert.equal(script.at(-1).delayMs, DEFAULT_SUSPENSE_MS, 'an unknown risk falls through to the low pause');
});

test('the suspense scales with risk, the way the cog does it', () => {
  assert.equal(suspenseFor('low'), 4_000);
  assert.equal(suspenseFor('medium'), 5_000);
  assert.equal(suspenseFor('high'), 6_000);
  assert.equal(suspenseFor('nonsense'), DEFAULT_SUSPENSE_MS);
});

test('the number of bail chances IS the number of beats', () => {
  // This is the whole point of the slice. S122 had one window; a four-event
  // bank job now has six.
  const script = crimeScript([ev('a'), ev('b'), ev('c'), ev('d')], 'high');
  assert.equal(script.length, 6);
});

// ── the invariant that makes the button honest ───────────────────────────────

test('the slowest possible crime still fits inside the bail window', () => {
  // If a script can outlast the button, the last beats are narrated under a
  // dead Bail Out — the player is shown a decision they can no longer make.
  assert.equal(scriptFitsBailWindow(), true);
  assert.ok(
    worstCaseDurationMs() <= ATTEMPT_WINDOW_MS,
    `worst case ${worstCaseDurationMs()}ms must not exceed the ${ATTEMPT_WINDOW_MS}ms window`,
  );
});

test('the worst case is computed from the real draw, not a guessed event count', () => {
  // Hard-coding "4 events" here would make the guard above stop tracking
  // reality the moment EVENT_CHANCES grows.
  const maxEvents = EVENT_CHANCES.length;
  const longest = crimeScript(Array.from({ length: maxEvents }, (_, i) => ev(`e${i}`)), 'high');
  assert.equal(scriptDurationMs(longest), worstCaseDurationMs());
});

test('a real crime’s longest script fits too', () => {
  // The data file is the thing that actually feeds the narrator; assert
  // against it rather than against synthetic events only.
  for (const [crimeType, pool] of Object.entries(crimeEvents())) {
    const drawn = pool.slice(0, EVENT_CHANCES.length);
    const duration = scriptDurationMs(crimeScript(drawn, 'high'));
    assert.ok(duration <= ATTEMPT_WINDOW_MS, `${crimeType}: ${duration}ms`);
  }
});

// ── the text ─────────────────────────────────────────────────────────────────

test('placeholders are filled in, because a literal {currency} is a bug the player sees', () => {
  assert.equal(
    formatEventText(ev('found {credits_bonus} {currency}!', { credits_bonus: 100 })),
    'found 100 🍩!',
  );
  assert.equal(
    formatEventText(ev('lost {credits_penalty} {currency}', { credits_penalty: 75 })),
    'lost 75 🍩',
  );
});

test('an event with no credit fields still renders cleanly', () => {
  assert.equal(formatEventText(ev('a guard walks past 🚔 (-15%)')), 'a guard walks past 🚔 (-15%)');
});

test('no shipped event text can leave an unsubstituted placeholder', () => {
  for (const [crimeType, pool] of Object.entries(crimeEvents())) {
    for (const event of pool) {
      assert.doesNotMatch(formatEventText(event), /\{[a-z_]+\}/, `${crimeType}: ${event.text}`);
    }
  }
});

// ── the running story ────────────────────────────────────────────────────────

const story = (played, events = [ev('first thing'), ev('second thing')]) =>
  storyLines(crimeScript(events, 'low'), played, { userId: '42', crimeType: 'bank_heist', bailCost: 100 }).join('\n');

test('the story grows one event at a time', () => {
  assert.doesNotMatch(story(1), /first thing/, 'the opening beat has shown nothing yet');
  assert.match(story(2), /first thing/);
  assert.doesNotMatch(story(2), /second thing/);
  assert.match(story(3), /second thing/);
});

test('every beat keeps the bail offer visible, price and catch included', () => {
  for (const played of [1, 2, 3, 4]) {
    const body = story(played);
    assert.match(body, /100/, `beat ${played} must still name the price`);
    assert.match(body, /burns the cooldown/, `beat ${played} must still name the catch`);
  }
});

test('the last beat says the verdict is coming', () => {
  assert.doesNotMatch(story(3), /This is it/);
  assert.match(story(4), /This is it/);
});

test('the crime is named in words, not in its storage key', () => {
  assert.match(story(1), /bank heist/);
  assert.doesNotMatch(story(1), /bank_heist/);
});
