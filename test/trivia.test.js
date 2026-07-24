import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  applyAnswer,
  pickQuestionIndex,
  questionModel,
  revealModel,
  scoreboard,
  validateSet,
} from '../src/modules/trivia/lib/game.js';
import {
  addPoint,
  clearAllRounds,
  endRound,
  getRound,
  getScores,
  loadSets,
  startRound,
} from '../src/modules/trivia/service.js';
import triviaCmd from '../src/modules/trivia/commands/trivia.js';
import triviaButtons from '../src/modules/trivia/events/trivia-buttons.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-trivia-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
  clearAllRounds();
});

let seq = 0;
const freshGuildId = () => `60000000000000${String((seq += 1)).padStart(4, '0')}`;

// ── set validation + the shipped data files ──────────────────────────────────

test('validateSet accepts a well-formed set and rejects broken ones', () => {
  const good = { set: 'demo', title: 'Demo', questions: [{ q: 'Q?', choices: ['a', 'b'], answer: 1 }] };
  assert.equal(validateSet(good).ok, true);
  assert.equal(validateSet(null).ok, false);
  assert.equal(validateSet({ ...good, set: 'Bad Name' }).ok, false);
  assert.equal(validateSet({ ...good, questions: [] }).ok, false);
  assert.equal(validateSet({ ...good, questions: [{ q: 'Q?', choices: ['a'], answer: 0 }] }).ok, false, 'one choice is no quiz');
  assert.equal(validateSet({ ...good, questions: [{ q: 'Q?', choices: ['a', 'b'], answer: 2 }] }).ok, false, 'answer out of range');
});

test('every shipped question set is valid and answers point at real choices', () => {
  const sets = loadSets({ force: true });
  assert.ok(sets.size >= 2, 'police-codes and world-police ship with the module');
  for (const set of sets.values()) {
    assert.equal(validateSet(set).ok, true, `${set.set} must validate`);
    for (const q of set.questions) {
      assert.ok(q.choices[q.answer] !== undefined, `${set.set}: "${q.q}" answer index resolves`);
    }
  }
});

// ── game rules ───────────────────────────────────────────────────────────────

test('pickQuestionIndex avoids immediate repeats when possible', () => {
  assert.equal(pickQuestionIndex(1, 0, () => 0.99), 0, 'single question has no alternative');
  assert.equal(pickQuestionIndex(10, 3, () => 0.35), 4, 'collision with last index shifts by one');
  assert.equal(pickQuestionIndex(10, 9, () => 0.99), 0, 'shift wraps around');
  assert.equal(pickQuestionIndex(10, 2, () => 0.55), 5, 'no collision keeps the draw');
});

test('applyAnswer: one guess each, first correct wins, round locks after a win', () => {
  const round = { answer: 2, answered: new Set(), winnerId: null };
  assert.equal(applyAnswer(round, 'u1', 0), 'wrong');
  assert.equal(applyAnswer(round, 'u1', 2), 'already-answered', 'no second guess after a miss');
  assert.equal(applyAnswer(round, 'u2', 2), 'winner');
  assert.equal(round.winnerId, 'u2');
  assert.equal(applyAnswer(round, 'u3', 2), 'round-won', 'late correct answers get nothing');
});

test('question and reveal models render labels, facts, and winners', () => {
  const set = {
    set: 'demo', title: 'Demo',
    questions: [{ q: 'What is 10-4?', choices: ['OK', 'Help'], answer: 0, fact: 'Classic.' }],
  };
  const q = questionModel(set, 0);
  assert.match(q.title, /Demo/);
  assert.deepEqual(q.choices.map((c) => c.label), ['A', 'B']);
  const won = revealModel(set, 0, 'u9');
  assert.match(won.description, /<@u9>/);
  assert.match(won.description, /\*\*A\. OK\*\*/);
  assert.match(won.description, /Classic\./);
  const cold = revealModel(set, 0, null);
  assert.match(cold.description, /Nobody got it/);
});

test('scoreboard sorts by points then id and respects the limit', () => {
  const rows = scoreboard({ a: 3, b: 5, c: 3, d: 1 }, 3);
  assert.deepEqual(rows, [
    { userId: 'b', points: 5 },
    { userId: 'a', points: 3 },
    { userId: 'c', points: 3 },
  ]);
});

// ── service state + scores ───────────────────────────────────────────────────

test('rounds are per channel and endRound clears the timer state', () => {
  const round = startRound('chan-1', { setId: 's', questionIndex: 0, answer: 1, roundId: 'r1' });
  assert.equal(getRound('chan-1'), round);
  assert.equal(getRound('chan-2'), null);
  endRound('chan-1');
  assert.equal(getRound('chan-1'), null);
});

test('addPoint accumulates in the store', () => {
  const guildId = freshGuildId();
  assert.equal(addPoint(guildId, 'u1'), 1);
  assert.equal(addPoint(guildId, 'u1'), 2);
  assert.equal(addPoint(guildId, 'u2'), 1);
  assert.deepEqual(getScores(guildId), { u1: 2, u2: 1 });
});

// ── command + button flow (fake interactions) ────────────────────────────────

function fakeStartInteraction(channelId, guildId) {
  const state = { replies: [], edits: [] };
  const message = { edit: async (p) => (state.edits.push(p), message) };
  return {
    state,
    interaction: {
      channel: { id: channelId },
      guild: { id: guildId },
      guildId,
      user: { id: 'starter' },
      createdTimestamp: 12345,
      options: { getString: () => null },
      reply: async (p) => {
        state.replies.push(p);
        return p.withResponse ? { resource: { message } } : p;
      },
    },
  };
}

test('/trivia starts a round with buttons; a second start in the channel is refused', async () => {
  clearAllRounds();
  const guildId = freshGuildId();
  const { interaction, state } = fakeStartInteraction('chan-t1', guildId);
  await triviaCmd.execute(interaction);
  assert.equal(state.replies.length, 1);
  assert.ok(state.replies[0].components?.length === 1, 'one button row');
  const round = getRound('chan-t1');
  assert.ok(round, 'round registered');
  assert.ok(round.message, 'message handle captured for the reveal');

  const again = fakeStartInteraction('chan-t1', guildId);
  await triviaCmd.execute(again.interaction);
  assert.match(again.state.replies[0].content, /already running/);
  endRound('chan-t1');
});

function fakeButton(channelId, guildId, userId, roundId, choice) {
  const replies = [];
  return {
    replies,
    interaction: {
      isButton: () => true,
      customId: `trivia:${roundId}:${choice}`,
      channelId,
      guildId,
      user: { id: userId },
      reply: async (p) => replies.push(p),
    },
  };
}

test('button flow: wrong gets one guess, correct scores and reveals, late is refused', async () => {
  clearAllRounds();
  const guildId = freshGuildId();
  const { interaction } = fakeStartInteraction('chan-t2', guildId);
  await triviaCmd.execute(interaction);
  const round = getRound('chan-t2');
  const wrongChoice = round.answer === 0 ? 1 : 0;

  const miss = fakeButton('chan-t2', guildId, 'u-miss', round.roundId, wrongChoice);
  await triviaButtons.execute(miss.interaction);
  assert.match(miss.replies[0].content, /Wrong answer/);

  const win = fakeButton('chan-t2', guildId, 'u-win', round.roundId, round.answer);
  await triviaButtons.execute(win.interaction);
  assert.match(win.replies[0].content, /Correct/);
  assert.deepEqual(getScores(guildId), { 'u-win': 1 });
  assert.equal(getRound('chan-t2'), null, 'round ended by the win');
  assert.equal(round.message !== null, true);

  const late = fakeButton('chan-t2', guildId, 'u-late', round.roundId, round.answer);
  await triviaButtons.execute(late.interaction);
  assert.match(late.replies[0].content, /round is over/i);
});

test('button presses from a stale round id are politely refused', async () => {
  clearAllRounds();
  const guildId = freshGuildId();
  const { interaction } = fakeStartInteraction('chan-t3', guildId);
  await triviaCmd.execute(interaction);
  const stale = fakeButton('chan-t3', guildId, 'u1', 'chan-t3-999', 0);
  await triviaButtons.execute(stale.interaction);
  assert.match(stale.replies[0].content, /round is over/i);
  endRound('chan-t3');
});

test('non-trivia buttons and non-button interactions are ignored', async () => {
  const replies = [];
  await triviaButtons.execute({ isButton: () => false, reply: async (p) => replies.push(p) });
  await triviaButtons.execute({
    isButton: () => true,
    customId: 'starboard:whatever',
    channelId: 'x',
    reply: async (p) => replies.push(p),
  });
  assert.equal(replies.length, 0);
});
