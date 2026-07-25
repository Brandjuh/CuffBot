// Guess the Candy (S80 = M16.7, AAA3A port, anagram re-theme): the pure
// draws and scramble, the round state machine with the double-win lock, and
// the group wiring incl. the `!gtc 8` fallback shape.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CANDIES,
  DEFAULT_DIFFICULTY,
  MAX_DIFFICULTY,
  MIN_DIFFICULTY,
  formatElapsed,
  pickAnswer,
  sampleCandies,
  scrambleName,
} from '../src/modules/guessthecandy/lib/game.js';
import {
  clearAllCandyGames,
  createCandyGame,
  endCandyGame,
  getCandyGame,
  pressCandy,
} from '../src/modules/guessthecandy/service.js';
import gtcCommand from '../src/modules/guessthecandy/commands/guessthecandy.js';

after(() => clearAllCandyGames());

const sequenceRandom = (values) => () => values.shift() ?? 0;

// ── pure rules ───────────────────────────────────────────────────────────────

test('the candy pool is the cog’s 23 names; bounds mirror it', () => {
  assert.equal(CANDIES.length, 23);
  assert.equal(MAX_DIFFICULTY, 23);
  assert.equal(MIN_DIFFICULTY, 5);
  assert.equal(DEFAULT_DIFFICULTY, 5);
  assert.ok(CANDIES.includes('KitKat'));
  assert.ok(CANDIES.includes("Reese's"));
  assert.equal(new Set(CANDIES).size, 23, 'no duplicates');
});

test('sampleCandies draws k distinct names without touching the pool', () => {
  const drawn = sampleCandies(() => 0, 5);
  assert.equal(drawn.length, 5);
  assert.equal(new Set(drawn).size, 5, 'distinct');
  assert.equal(CANDIES.length, 23, 'pool untouched');
  drawn.forEach((c) => assert.ok(CANDIES.includes(c)));
  const answer = pickAnswer(() => 0.999999, drawn);
  assert.ok(drawn.includes(answer), 'the answer is always among the buttons');
});

test('scrambleName shuffles letters per word, keeps boundaries, differs from the input', () => {
  let calls = 0;
  const random = () => {
    calls += 1;
    return (calls % 7) / 7;
  };
  const scrambled = scrambleName(random, 'Gummy Bears');
  assert.equal(scrambled.split(' ').length, 2, 'word boundary kept');
  assert.notEqual(scrambled, 'Gummy Bears', 'must differ');
  const sortLetters = (s) => [...s.replace(' ', '')].sort().join('');
  assert.equal(sortLetters(scrambled), sortLetters('Gummy Bears'), 'same letters');
});

test('formatElapsed shows two decimals like the cog', () => {
  assert.equal(formatElapsed(1234), '1.23');
  assert.equal(formatElapsed(60_000), '60.00');
});

// ── round state machine ──────────────────────────────────────────────────────

test('rounds are keyed by game id — multiple rounds can run in one channel', () => {
  const a = createCandyGame('chan-1', 'g1', { random: () => 0 });
  const b = createCandyGame('chan-1', 'g1', { random: () => 0 });
  assert.notEqual(a.id, b.id);
  assert.equal(getCandyGame(a.id), a);
  assert.equal(getCandyGame(b.id), b);
  endCandyGame(a.id);
  endCandyGame(b.id);
  assert.equal(getCandyGame(a.id), null);
});

test('pressCandy: wrong is free, the first correct press wins, later presses are ended', () => {
  const game = createCandyGame('chan-2', 'g1', { random: () => 0 });
  const wrong = game.candies.find((c) => c !== game.answer);
  assert.equal(pressCandy(game, wrong), 'wrong');
  assert.equal(game.ended, false, 'wrong presses never end the round');
  assert.equal(pressCandy(game, game.answer), 'won');
  assert.equal(game.ended, true, 'the win flips ended synchronously (double-win lock)');
  assert.equal(pressCandy(game, game.answer), 'ended');
  assert.equal(pressCandy(game, wrong), 'ended');
  endCandyGame(game.id);
});

test('createCandyGame seeds a scrambled answer that differs but matches letters', () => {
  const game = createCandyGame('chan-3', 'g1', { difficulty: 8, random: sequenceRandom([0.9, 0.5, 0.1, 0.7, 0.3, 0.6, 0.2, 0.8, 0.4, 0.55, 0.15, 0.65]) });
  assert.equal(game.candies.length, 8);
  assert.ok(game.candies.includes(game.answer));
  const strip = (s) => [...s.replace(/ /g, '')].sort().join('');
  assert.equal(strip(game.scrambled), strip(game.answer));
  endCandyGame(game.id);
});

// ── group wiring ─────────────────────────────────────────────────────────────

test('!guessthecandy: public group, gtc alias, play fallback, difficulty bounds', async () => {
  const group = gtcCommand.group;
  assert.equal(group.name, 'guessthecandy');
  assert.deepEqual(group.aliases, ['gtc']);
  assert.equal(group.permission, undefined, 'anyone can start');
  assert.equal(group.fallback, 'play', '`!gtc 8` routes into play');

  const replies = [];
  const ctx = {
    prefix: '!',
    guild: { id: 'g1' },
    channel: { id: 'chan-4' },
    user: { id: 'u1' },
    reply: async (p) => {
      replies.push(typeof p === 'string' ? { content: p } : p);
      return { edit: async () => {}, reply: async () => {} };
    },
  };
  const play = group.subcommands[0];
  await play.run(ctx, { difficulty: 4 });
  assert.match(replies[0].content, /must be 5–23/);
  await play.run(ctx, { difficulty: 24 });
  assert.match(replies[1].content, /must be 5–23/);

  await play.run(ctx, { difficulty: 23 });
  const board = replies[2];
  assert.ok(board.embeds, 'round posted');
  assert.equal(board.components.length, 5, '23 buttons = 5 rows');
  assert.match(board.embeds[0].toJSON().description, /```/, 'scrambled name in a code block');
  clearAllCandyGames();
});
