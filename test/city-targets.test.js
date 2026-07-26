// M26.3b: picking a mark from the panel.
//
// Before this, a targeted crime picked from the panel answered "run `!crime
// pickpocket @member`" — throwing the player back out to the text surface the
// panel was built to replace.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TARGET_REFUSAL,
  eligibleTargets,
  pickRandomTarget,
  targetProblem,
} from '../src/modules/city/lib/targets.js';

const ME = '1';
const opts = (over = {}) => ({ selfId: ME, minBalance: 100, ...over });
const who = (id, over = {}) => ({ id, bot: false, jailed: false, balance: 500, ...over });

// ── one candidate at a time ──────────────────────────────────────────────────

test('a fine target has no problem', () => {
  assert.equal(targetProblem(who('2'), opts()), null);
});

test('the four reasons a mark is off the table', () => {
  assert.equal(targetProblem(who(ME), opts()), 'self');
  assert.equal(targetProblem(who('2', { bot: true }), opts()), 'bot');
  assert.equal(targetProblem(who('2', { jailed: true }), opts()), 'jailed');
  assert.equal(targetProblem(who('2', { balance: 99 }), opts()), 'too-poor');
});

test('exactly the minimum is enough', () => {
  assert.equal(targetProblem(who('2', { balance: 100 }), opts()), null);
  assert.equal(targetProblem(who('2', { balance: 99 }), opts()), 'too-poor');
});

test('"that is you" beats "they are broke" when both are true', () => {
  // The player needs the reason that is actually actionable.
  assert.equal(targetProblem(who(ME, { balance: 0 }), opts()), 'self');
});

test('every problem has a sentence to show for it', () => {
  for (const reason of ['self', 'bot', 'jailed', 'too-poor', 'repeat', 'nobody']) {
    assert.equal(typeof TARGET_REFUSAL[reason], 'string', `no message for '${reason}'`);
    assert.ok(TARGET_REFUSAL[reason].length > 0);
  }
});

// ── the last-target rule ─────────────────────────────────────────────────────

test('the roller will not hand you the same mark twice running', () => {
  assert.equal(targetProblem(who('2'), opts({ lastTargetId: '2' })), 'repeat');
  assert.equal(targetProblem(who('3'), opts({ lastTargetId: '2' })), null);
});

test('a deliberate pick is not subject to the repeat rule', () => {
  // Refusing a name the player chose themselves is different from refusing to
  // roll it; only the roll is the cog's concern. The caller expresses that by
  // clearing lastTargetId, so assert the function honours the distinction.
  assert.equal(targetProblem(who('2'), opts({ lastTargetId: null })), null);
});

// ── rolling ──────────────────────────────────────────────────────────────────

const firstPick = { pick: (list) => list[0] };

test('the roller only ever lands on someone eligible', () => {
  const crowd = [who(ME), who('2', { bot: true }), who('3', { jailed: true }), who('4', { balance: 1 }), who('5')];
  const rolled = pickRandomTarget(crowd, opts(), firstPick);
  assert.equal(rolled.ok, true);
  assert.equal(rolled.target.id, '5');
  assert.equal(rolled.repeat, false);
});

test('a guild with nobody worth robbing says so instead of throwing', () => {
  const rolled = pickRandomTarget([who(ME), who('2', { bot: true })], opts(), firstPick);
  assert.deepEqual(rolled, { ok: false, reason: 'nobody' });
});

test('when the ONLY eligible mark is your last one, the roll allows the repeat', () => {
  // A two-person guild would otherwise never get a random target at all. The
  // repeat is flagged so the caller can say so.
  const rolled = pickRandomTarget([who(ME), who('2')], opts({ lastTargetId: '2' }), firstPick);
  assert.equal(rolled.ok, true);
  assert.equal(rolled.target.id, '2');
  assert.equal(rolled.repeat, true);
});

test('a fresh mark is preferred over the repeat when both exist', () => {
  const rolled = pickRandomTarget([who('2'), who('3')], opts({ lastTargetId: '2' }), firstPick);
  assert.equal(rolled.target.id, '3');
  assert.equal(rolled.repeat, false);
});

test('eligibleTargets is the filter the roller uses, not a second opinion', () => {
  const crowd = [who(ME), who('2'), who('3', { jailed: true })];
  assert.deepEqual(eligibleTargets(crowd, opts()).map((t) => t.id), ['2']);
});

test('a malformed candidate is refused rather than crashing the roll', () => {
  assert.equal(targetProblem(null, opts()), 'bot');
  assert.equal(targetProblem({}, opts()), 'bot');
  assert.deepEqual(pickRandomTarget([null, {}], opts(), firstPick), { ok: false, reason: 'nobody' });
});
