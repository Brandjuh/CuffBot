// Wordle (S83 = M16.10, AAA3A wordlegame port): the NAIVE coloring rule
// pinned exactly (incl. the duplicate-letter divergence from classic Wordle),
// diacritic folding, the emoji grid, the bundled EN lists, the guess machine
// (ignored/invalid/cancel/accepted), the FIXED loss check (respects
// maxAttempts instead of the cog's hardcoded 6), and stats.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  ATTEMPTS_MAX,
  DISTRIBUTION_SIZE,
  LENGTH_MAX,
  LENGTH_MIN,
  colorRow,
  foldDiacritics,
  isGuessShaped,
  renderGrid,
} from '../src/modules/wordle/lib/game.js';
import { isDictionaryWord, loadWordLists, pickWord } from '../src/modules/wordle/lib/words.js';
import {
  clearAllWordleGames,
  createWordleGame,
  endWordleGame,
  getWordleGame,
  getWordleStats,
  recordFinished,
  submitGuess,
} from '../src/modules/wordle/service.js';
import wordleCommand from '../src/modules/wordle/commands/wordle.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-wordle-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
  clearAllWordleGames();
});

let seq = 0;
const freshGuildId = () => `83000000000000${String((seq += 1)).padStart(4, '0')}`;

/** A game with a known secret: create against the real lists, then pin word. */
function gameWith(word, { maxAttempts = 6 } = {}) {
  const guildId = freshGuildId();
  const result = createWordleGame(guildId, 'chan', 'alice', {
    length: word.length,
    maxAttempts,
    random: () => 0,
  });
  result.game.word = word;
  return { guildId, game: result.game };
}

// ── pure rules ───────────────────────────────────────────────────────────────

test('colorRow is the cog rule verbatim — including the naive duplicate yellows', () => {
  assert.deepEqual(colorRow('crane', 'crane'), ['green', 'green', 'green', 'green', 'green']);
  assert.deepEqual(colorRow('crane', 'pride'), ['grey', 'green', 'grey', 'grey', 'green']);
  // Naive divergence: 'crane' has ONE e, but BOTH leading e's go yellow
  // (classic Wordle would color one). Survey mandate: copy, don't fix.
  assert.deepEqual(colorRow('crane', 'eexit'), ['yellow', 'yellow', 'grey', 'grey', 'grey']);
  // A letter greened elsewhere never doubles as yellow (attempt[k] == word[k]
  // blocks the any() clause).
  assert.deepEqual(colorRow('crane', 'geese'), ['grey', 'grey', 'grey', 'grey', 'green']);
});

test('foldDiacritics and the guess-shape predicate mirror the cog', () => {
  assert.equal(foldDiacritics('café'), 'cafe');
  assert.equal(foldDiacritics('jalapeño'), 'jalapeno');
  assert.equal(isGuessShaped('crane', 5), true);
  assert.equal(isGuessShaped('café!', 5), false, 'punctuation is not a letter');
  assert.equal(isGuessShaped('cafés', 5), true, 'unicode letters count (Python isalpha)');
  assert.equal(isGuessShaped('cran', 5), false, 'length must match exactly');
});

test('renderGrid: played rows show squares + the word, the rest are empty', () => {
  const grid = renderGrid('crane', ['pride'], 6);
  const lines = grid.split('\n');
  assert.equal(lines.length, 6);
  assert.equal(lines[0], '⬛🟩⬛⬛🟩 `PRIDE`');
  assert.equal(lines[1], '⬜⬜⬜⬜⬜');
  assert.equal(lines[5], '⬜⬜⬜⬜⬜');
});

// ── word lists ───────────────────────────────────────────────────────────────

test('the bundled EN lists cover every length 4–11 and answers are always guessable', () => {
  const { words, dictionary } = loadWordLists();
  for (let length = LENGTH_MIN; length <= LENGTH_MAX; length += 1) {
    assert.ok(words.get(length).length > 0, `answers exist for length ${length}`);
    assert.ok(dictionary.get(length).size > 0, `dictionary exists for length ${length}`);
    assert.ok(dictionary.get(length).has(words.get(length)[0]), 'every answer is a valid guess');
  }
  assert.equal(words.get(5).length, 2377, 'the cog answer list, verbatim');
  assert.equal(dictionary.get(6).has('cancel'), false, 'the quit keyword is skipped at load (cog behavior)');
  assert.equal(isDictionaryWord('crane'), true);
  assert.equal(isDictionaryWord('zzzzz'), false);
  assert.equal(pickWord(() => 0, 5), words.get(5)[0], 'seeded pick is deterministic');
});

// ── the guess machine ────────────────────────────────────────────────────────

test('submitGuess: ignored shapes, invalid words cost nothing, accepted guesses accumulate, winning ends', () => {
  const { game } = gameWith('crane');
  assert.equal(submitGuess(game, 'stakeout').code, 'ignored', 'wrong length is silent');
  assert.equal(submitGuess(game, 'cr4ne').code, 'ignored', 'non-letters are silent');
  assert.equal(submitGuess(game, 'zzzzz').code, 'invalid', 'not in the dictionary');
  assert.equal(game.attempts.length, 0, 'invalid words use NO attempt');
  assert.deepEqual(submitGuess(game, 'pride'), { code: 'accepted', won: false, lost: false });
  assert.deepEqual(submitGuess(game, 'CRANE'), { code: 'accepted', won: true, lost: false }, 'case-insensitive');
  assert.equal(game.ended, true, 'the win flips ended synchronously (S22)');
  assert.deepEqual(game.attempts, ['pride', 'crane']);
  assert.equal(submitGuess(game, 'crane').code, 'ended');
  endWordleGame(game);
});

test('the loss check respects maxAttempts — the cog hardcoded 6 (recorded deviation fixed)', () => {
  const wrongFive = ['pride', 'stone', 'flame', 'chart', 'blimp'];
  const five = gameWith('crane', { maxAttempts: 5 });
  for (let i = 0; i < 4; i += 1) assert.equal(submitGuess(five.game, wrongFive[i]).lost, false);
  assert.equal(submitGuess(five.game, wrongFive[4]).lost, true, 'the 5th wrong guess loses a 5-attempt game');
  assert.equal(five.game.ended, true);
  endWordleGame(five.game);

  const seven = gameWith('crane', { maxAttempts: 7 });
  const wrongSeven = [...wrongFive, 'gourd', 'wispy'];
  for (let i = 0; i < 6; i += 1) {
    assert.equal(submitGuess(seven.game, wrongSeven[i]).lost, false, `guess ${i + 1} of 7 does not lose`);
  }
  assert.equal(submitGuess(seven.game, wrongSeven[6]).lost, true, 'only the 7th wrong guess loses');
  endWordleGame(seven.game);
});

test('cancel (any case) ends the game without a loss flag', () => {
  const { game } = gameWith('crane');
  const result = submitGuess(game, 'CANCEL');
  assert.equal(result.code, 'cancel');
  assert.equal(game.ended, true);
  assert.equal(game.won, false);
  assert.equal(game.lost, false);
  endWordleGame(game);
});

test('one game per member: busy for the same officer, independent for another', () => {
  const guildId = freshGuildId();
  const first = createWordleGame(guildId, 'chan', 'alice', { length: 5, maxAttempts: 6, random: () => 0 });
  assert.ok(first.game);
  assert.equal(createWordleGame(guildId, 'chan2', 'alice', { length: 5, maxAttempts: 6 }).error, 'busy');
  const second = createWordleGame(guildId, 'chan', 'bob', { length: 5, maxAttempts: 6, random: () => 0 });
  assert.ok(second.game, 'another member plays in parallel');
  assert.equal(getWordleGame(guildId, 'alice'), first.game);
  endWordleGame(first.game);
  endWordleGame(second.game);
  assert.equal(getWordleGame(guildId, 'alice'), null);
});

// ── stats ────────────────────────────────────────────────────────────────────

test('stats: every finished game counts; wins fill the guess distribution slot', () => {
  const guildId = freshGuildId();
  recordFinished(guildId, 'alice', { won: true, attemptsUsed: 3 });
  recordFinished(guildId, 'alice', { won: false });
  recordFinished(guildId, 'alice', { won: true, attemptsUsed: 3 });
  recordFinished(guildId, 'alice', { won: true, attemptsUsed: ATTEMPTS_MAX });
  const stats = getWordleStats(guildId, 'alice');
  assert.equal(stats.games, 4, 'losses/cancels/timeouts count too (cog placement)');
  assert.equal(stats.wins, 3);
  assert.equal(stats.distribution.length, DISTRIBUTION_SIZE);
  assert.equal(stats.distribution[2], 2, 'two wins in 3 attempts');
  assert.equal(stats.distribution[ATTEMPTS_MAX - 1], 1);
  assert.deepEqual(getWordleStats(guildId, 'ghost'), {
    wins: 0,
    games: 0,
    distribution: Array(DISTRIBUTION_SIZE).fill(0),
  });
});

// ── group wiring ─────────────────────────────────────────────────────────────

test('!wordle group shape: public play/stats, play fallback, integer options', () => {
  const group = wordleCommand.group;
  assert.equal(group.name, 'wordle');
  assert.ok(group.aliases.includes('wordlegame'));
  assert.equal(group.permission, undefined, 'the group is public');
  assert.equal(group.fallback, 'play');
  assert.deepEqual(
    group.subcommands.map((s) => [s.name, s.permission ?? null]),
    [
      ['play', null],
      ['stats', null],
    ],
  );
  const play = group.subcommands[0];
  assert.deepEqual(
    play.args.map((a) => [a.name, a.type, a.required ?? false]),
    [
      ['length', 'integer', false],
      ['attempts', 'integer', false],
    ],
  );
});
