import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignOptions, extractId, parseCommandLine, tokenize } from '../src/core/prefix/parse.js';

const T = { STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6 };

test('tokenize keeps quoted spans together', () => {
  assert.deepEqual(tokenize('a b c'), ['a', 'b', 'c']);
  assert.deepEqual(tokenize('a "b c" d'), ['a', 'b c', 'd']);
  assert.deepEqual(tokenize('   spread   out  '), ['spread', 'out']);
  assert.deepEqual(tokenize(''), []);
});

test('parseCommandLine splits name from args and lowercases the name', () => {
  assert.deepEqual(parseCommandLine('!Detain @u 2h spam', '!'), {
    name: 'detain',
    argString: '@u 2h spam',
    tokens: ['@u', '2h', 'spam'],
  });
  assert.deepEqual(parseCommandLine('!help', '!'), { name: 'help', argString: '', tokens: [] });
});

test('parseCommandLine rejects non-commands', () => {
  assert.equal(parseCommandLine('hello', '!'), null);
  assert.equal(parseCommandLine('!', '!'), null);
  assert.equal(parseCommandLine('! spaced', '!'), null);
  assert.equal(parseCommandLine('/slash', '!'), null);
});

test('extractId reads mentions and raw snowflakes', () => {
  assert.equal(extractId('<@411157175948541954>'), '411157175948541954');
  assert.equal(extractId('<@!411157175948541954>'), '411157175948541954');
  assert.equal(extractId('411157175948541954'), '411157175948541954');
  assert.equal(extractId('not-an-id'), null);
  assert.equal(extractId('123'), null);
});

test('assignOptions maps positional args; last string is greedy', () => {
  const defs = [
    { name: 'target', type: T.USER, required: true },
    { name: 'duration', type: T.STRING, required: true },
    { name: 'reason', type: T.STRING, required: false },
  ];
  const parsed = parseCommandLine('!detain <@411157175948541954> 2h being a repeat offender', '!');
  const { values, userIds, errors } = assignOptions(defs, parsed);
  assert.deepEqual(errors, []);
  assert.equal(userIds.target, '411157175948541954');
  assert.equal(values.duration, '2h');
  assert.equal(values.reason, 'being a repeat offender');
});

test('assignOptions reports missing required args', () => {
  const defs = [
    { name: 'target', type: T.USER, required: true },
    { name: 'reason', type: T.STRING, required: true },
  ];
  const { errors } = assignOptions(defs, parseCommandLine('!cite', '!'));
  assert.equal(errors.length, 2);
  assert.match(errors.join(' '), /target/);
  assert.match(errors.join(' '), /reason/);
});

test('assignOptions validates integers and choices', () => {
  const defs = [{ name: 'wipe', type: T.INTEGER, choices: [{ value: 0 }, { value: 3600 }] }];
  assert.deepEqual(assignOptions(defs, parseCommandLine('!arrest 3600', '!')).values, { wipe: 3600 });
  assert.match(
    assignOptions(defs, parseCommandLine('!arrest 999', '!')).errors[0],
    /must be one of/,
  );
  assert.match(
    assignOptions(defs, parseCommandLine('!arrest notanumber', '!')).errors[0],
    /should be a number/,
  );
});

test('assignOptions parses booleans flexibly', () => {
  const defs = [{ name: 'anon', type: T.BOOLEAN, required: true }];
  assert.equal(assignOptions(defs, parseCommandLine('!911 yes', '!')).values.anon, true);
  assert.equal(assignOptions(defs, parseCommandLine('!911 off', '!')).values.anon, false);
  assert.match(assignOptions(defs, parseCommandLine('!911 maybe', '!')).errors[0], /true\/false/);
});

// Regression: a free-text `reason` declared BEFORE an optional option must
// absorb the whole middle of the line — not be truncated (cite/fine) or error
// (arrest/911). Driven by the command's textGreedyArg.
const INT = 4;
test('greedy reason before an optional string (cite/fine): reason takes all, penalty stays slash-only', () => {
  const defs = [
    { name: 'target', type: T.USER, required: true },
    { name: 'reason', type: T.STRING, required: true },
    { name: 'penalty', type: T.STRING },
  ];
  const r = assignOptions(defs, parseCommandLine('!cite <@411157175948541954> talking in all caps', '!'), 'reason');
  assert.deepEqual(r.errors, []);
  assert.equal(r.values.reason, 'talking in all caps');
  assert.equal(r.values.penalty, undefined);
});

test('greedy reason before an optional integer (arrest): number at the tail binds, else reason absorbs it', () => {
  const defs = [
    { name: 'target', type: T.USER, required: true },
    { name: 'reason', type: T.STRING, required: true },
    { name: 'wipe', type: INT, choices: [{ value: 0 }, { value: 3600 }] },
  ];
  const noNum = assignOptions(defs, parseCommandLine('!arrest <@411157175948541954> being disruptive in chat', '!'), 'reason');
  assert.deepEqual(noNum.errors, []);
  assert.equal(noNum.values.reason, 'being disruptive in chat');
  assert.equal(noNum.values.wipe, undefined);

  const withNum = assignOptions(defs, parseCommandLine('!arrest <@411157175948541954> spamming links 3600', '!'), 'reason');
  assert.equal(withNum.values.reason, 'spamming links');
  assert.equal(withNum.values.wipe, 3600);
});

test('greedy reason before an optional boolean (911): flag binds only when it reads as true/false', () => {
  const defs = [
    { name: 'target', type: T.USER, required: true },
    { name: 'reason', type: T.STRING, required: true },
    { name: 'anonymous', type: T.BOOLEAN },
  ];
  const noFlag = assignOptions(defs, parseCommandLine('!911 <@411157175948541954> harassing people in general', '!'), 'reason');
  assert.equal(noFlag.values.reason, 'harassing people in general');
  assert.equal(noFlag.values.anonymous, undefined);

  const withFlag = assignOptions(defs, parseCommandLine('!911 <@411157175948541954> being toxic true', '!'), 'reason');
  assert.equal(withFlag.values.reason, 'being toxic');
  assert.equal(withFlag.values.anonymous, true);
});

test('a required option after the greedy still binds from the tail', () => {
  const defs = [
    { name: 'reason', type: T.STRING, required: true },
    { name: 'target', type: T.USER, required: true },
  ];
  const r = assignOptions(defs, parseCommandLine('!x being a repeat offender <@411157175948541954>', '!'), 'reason');
  assert.deepEqual(r.errors, []);
  assert.equal(r.values.reason, 'being a repeat offender');
  assert.equal(r.userIds.target, '411157175948541954');
});
