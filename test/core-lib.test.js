import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHomeGuild } from '../src/modules/core/lib/precinct.js';
import { describeLatency } from '../src/modules/core/lib/radio.js';

test('isHomeGuild matches only the home precinct', () => {
  assert.equal(isHomeGuild('411157175948541954', '411157175948541954'), true);
  assert.equal(isHomeGuild('999999999999999999', '411157175948541954'), false);
  // ids may arrive as bigints/numbers from odd code paths — compare as strings
  assert.equal(isHomeGuild(411157175948541954n, '411157175948541954'), true);
});

test('describeLatency picks the right verdict per band', () => {
  assert.match(describeLatency(42), /Loud and clear. Round-trip: 42 ms\./);
  assert.match(describeLatency(149), /Loud and clear/);
  assert.match(describeLatency(150), /bit of static/);
  assert.match(describeLatency(399), /bit of static/);
  assert.match(describeLatency(400), /Signal is rough/);
});

test('describeLatency clamps negative clock skew to zero', () => {
  assert.match(describeLatency(-5), /Round-trip: 0 ms\./);
});
