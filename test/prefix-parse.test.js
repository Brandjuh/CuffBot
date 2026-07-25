import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommandLine, tokenize } from '../src/core/prefix/parse.js';

// S96: the option-assignment tests moved out with `assignOptions`, which
// existed to feed the interaction adapter. Typed arg resolution now lives in
// prefix/group.js and is covered by test/prefix-command.test.js. What is left
// here is what parse.js still does: cut a line into a name and its tokens.

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

