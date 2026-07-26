// M26.3a: the crime panel — the fix for the divergence S115 measured at 48
// source UI references against our 0, and the one the owner reported twice.
//
// Pure only: `crimePanel` takes plain objects, so "a crime on cooldown is not
// selectable" is assertable without a gateway.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  ATTEMPT_WINDOW_MS,
  BAIL_OUT_COST,
  attemptPanel,
  bailOutOutcome,
  crimeOptions,
  crimePanel,
  shortWait,
  targetPanel,
} from '../src/modules/city/lib/panel.js';
import { CRIMES } from '../src/modules/city/lib/tables.js';

const NOW = 1_000_000;
const free = () => () => 0;
const onCooldown = (type, ms) => (t) => (t === type ? ms : 0);
const criminal = (over = {}) => ({ streak: 0, cooldowns: {}, ...over });

const panel = (over = {}) =>
  crimePanel({
    criminal: criminal(),
    balance: 500,
    jail: { jailed: false },
    cooldownLeft: free(),
    now: NOW,
    ...over,
  });

// ── the picker ───────────────────────────────────────────────────────────────

test('every crime appears, so the picker does not change shape between glances', () => {
  const options = panel().options;
  assert.equal(options.length, Object.keys(CRIMES).length);
  assert.equal(options.every((o) => o.selectable), true, 'nothing is on cooldown here');
});

test('a crime on cooldown stays VISIBLE but unselectable, and says how long', () => {
  // Hiding it would make the list change between glances, and "wait 4m" is
  // more useful than an option that silently is not there.
  const first = Object.keys(CRIMES)[0];
  const options = panel({ cooldownLeft: onCooldown(first, 4 * 60_000) }).options;
  const row = options.find((o) => o.type === first);
  assert.equal(row.selectable, false);
  assert.equal(row.unavailable, 'wait 4m 00s');
  assert.equal(options.filter((o) => o.selectable).length, options.length - 1, 'the others are unaffected');
});

test('jail replaces the picker entirely rather than offering jobs you cannot do', () => {
  const p = panel({ jail: { jailed: true, remainingMs: 90 * 60_000 } });
  assert.deepEqual(p.options, []);
  assert.equal(p.jailed, true);
  assert.match(p.title, /Behind bars/);
  assert.match(p.lines.join('\n'), /out in \*\*1h 30m\*\*/);
});

test('jail leads with the two choices that only exist there', () => {
  const p = panel({ jail: { jailed: true, remainingMs: 60_000 } });
  assert.deepEqual(p.buttons.slice(0, 2).map((b) => b.id), ['bail', 'jailbreak']);
});

test('the market is reachable from a cell — that is when you want the jail pass', () => {
  const jailed = panel({ jail: { jailed: true, remainingMs: 60_000 } }).buttons.map((b) => b.id);
  assert.ok(jailed.includes('market'), 'buying your way out is the point of the market');
});

// S122 asserted a hard-coded ['refresh'] to keep dead buttons off the panel.
// S124 gave Market and Board somewhere to go, so the list changed — but the
// GUARD is the part worth keeping, and a literal list cannot express it.
// Assert the real rule instead: every button the panel offers is an action the
// pump handles. That survives the next slice adding a button; the list did not.
test('every panel button is an action the pump actually handles', async () => {
  const source = await readFile(new URL('../src/modules/city/events/panel.js', import.meta.url), 'utf8');
  const offered = new Set([
    ...panel().buttons.map((b) => b.id),
    ...panel({ jail: { jailed: true, remainingMs: 60_000 } }).buttons.map((b) => b.id),
  ]);
  for (const id of offered) {
    assert.match(source, new RegExp(`action === '${id}'`), `nothing in the pump answers to '${id}'`);
  }
});

test('the attempt button and the target buttons carry their argument in the id', () => {
  // `bail-out:<crime>` and `roll:<crime>` are parsed positionally by the pump,
  // so a bare id here would silently lose the crime.
  assert.match(attemptPanel('bank_heist', '1').buttons[0].id, /^bail-out:bank_heist$/);
  assert.match(targetPanel('pickpocket', '1', 100).buttons[0].id, /^roll:pickpocket$/);
});

test('the target panel names the minimum, because that is why picks get refused', () => {
  const body = targetPanel('mugging', '77', 400).lines.join('\n');
  assert.match(body, /400/);
  assert.match(body, /Bots, cellmates and you are off the table/);
});

test('the panel says how many jobs are actually available', () => {
  assert.match(panel().lines.join('\n'), /available/);
  const allBusy = panel({ cooldownLeft: () => 60_000 });
  assert.match(allBusy.lines.join('\n'), /Everything is on cooldown/);
});

test('a streak is shown, and its absence is not', () => {
  assert.match(panel({ criminal: criminal({ streak: 3 }) }).lines.join('\n'), /3 clean jobs/);
  assert.doesNotMatch(panel().lines.join('\n'), /Streak/);
  assert.match(panel({ criminal: criminal({ streak: 1 }) }).lines.join('\n'), /1 clean job\b/, 'singular');
});

test('targeted crimes are flagged, because the picker cannot ask for a target', () => {
  const targeted = panel().options.filter((o) => o.requiresTarget);
  assert.ok(targeted.length > 0, 'pickpocket and mug need a victim');
  assert.equal(targeted.every((o) => typeof o.label === 'string'), true);
});

// ── bailing out: the mechanic that did not exist ─────────────────────────────

test('bailing out costs a flat 100, the cog’s number', () => {
  assert.equal(BAIL_OUT_COST, 100);
  assert.deepEqual(bailOutOutcome(500), { ok: true, cost: 100 });
});

test('you cannot bail out with an empty wallet', () => {
  assert.deepEqual(bailOutOutcome(99), { ok: false, reason: 'too-poor', cost: 100 });
  assert.equal(bailOutOutcome(100).ok, true, 'exactly enough is enough');
});

test('the attempt window is the cog’s 30 seconds', () => {
  assert.equal(ATTEMPT_WINDOW_MS, 30_000);
});

test('the attempt panel offers Bail Out and says what it costs', () => {
  const p = attemptPanel('bank', '123');
  assert.deepEqual(p.buttons.map((b) => b.id), ['bail-out:bank']);
  const body = p.lines.join('\n');
  assert.match(body, /100/);
  assert.match(body, /burns the cooldown/, 'the catch has to be stated, or it reads as a free escape');
  assert.match(body, /<@123>/);
});

// ── the formatter ────────────────────────────────────────────────────────────

test('waits read as waits', () => {
  assert.equal(shortWait(0), '0s');
  assert.equal(shortWait(45_000), '45s');
  assert.equal(shortWait(90_000), '1m 30s');
  assert.equal(shortWait(3_600_000), '1h 00m');
  assert.equal(shortWait(5_430_000), '1h 30m', '90.5 minutes floors to 1h 30m');
});

test('a wait is rounded UP, so "0s" never means "still waiting"', () => {
  assert.equal(shortWait(1), '1s');
  assert.equal(shortWait(-5), '0s', 'a passed deadline is zero, not negative');
});
