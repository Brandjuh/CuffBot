import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeSecret, botIdFromToken, tokenFingerprint } from '../src/core/diagnostics.js';

test('analyzeSecret passes a clean value', () => {
  assert.deepEqual(analyzeSecret('abc.def.ghi').issues, []);
});

test('analyzeSecret flags quotes, whitespace, and CR', () => {
  assert.ok(analyzeSecret('"abc.def.ghi"').issues.some((i) => i.includes('quotes')));
  assert.ok(analyzeSecret(' abc.def.ghi').issues.some((i) => i.includes('whitespace')));
  assert.ok(analyzeSecret('abc.def.ghi\r').issues.some((i) => i.includes('carriage return')));
  assert.ok(analyzeSecret('').issues.some((i) => i.includes('empty')));
});

test('tokenFingerprint masks the token and counts segments', () => {
  const fp = tokenFingerprint('AAAABBBB.CC.DDDDEEEE');
  assert.equal(fp.dotParts, 3);
  assert.equal(fp.preview, 'AAAA…EEEE');
  assert.ok(!fp.preview.includes('BBBB.CC'), 'middle must stay masked');
});

test('botIdFromToken decodes a snowflake from the first segment', () => {
  const id = '411157175948541954';
  const token = `${Buffer.from(id, 'utf8').toString('base64')}.xxxx.yyyy`;
  assert.equal(botIdFromToken(token), id);
  assert.equal(botIdFromToken('not-base64-snowflake.a.b'), null);
  assert.equal(botIdFromToken(''), null);
});
