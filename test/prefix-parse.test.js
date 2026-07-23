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
