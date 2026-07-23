import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  badgeEmbed,
  hashSeed,
  pickBounty,
  pickCrime,
  pickDonut,
  reportEmbed,
  wantedEmbed,
} from '../src/modules/public-affairs/lib/cards.js';

test('hashSeed is deterministic and unsigned', () => {
  assert.equal(hashSeed('abc'), hashSeed('abc'));
  assert.notEqual(hashSeed('abc'), hashSeed('abd'));
  assert.ok(hashSeed('anything') >= 0);
});

test('badgeEmbed shows rank, record, and join date; falls back gracefully', () => {
  const full = badgeEmbed({ displayName: 'Rook', joinedTimestamp: 1_700_000_000_000, rankName: 'Sergeant', recordCount: 2, avatarURL: 'http://x/a.png' });
  assert.match(full.title, /Rook/);
  assert.equal(full.fields.find((f) => f.name === 'Rank').value, 'Sergeant');
  assert.equal(full.fields.find((f) => f.name === 'Record').value, '2 entries');
  assert.match(full.fields.find((f) => f.name === 'On the force since').value, /^<t:\d+:D>$/);
  assert.equal(full.thumbnail.url, 'http://x/a.png');

  const bare = badgeEmbed({ displayName: 'Nobody', recordCount: 0 });
  assert.equal(bare.fields.find((f) => f.name === 'Rank').value, 'Unranked');
  assert.equal(bare.fields.find((f) => f.name === 'Record').value, '0 entries');
  assert.equal(bare.fields.find((f) => f.name === 'On the force since').value, 'unknown');
  assert.equal(bare.thumbnail, undefined);
});

test('wanted picks are deterministic per seed and in range', () => {
  assert.equal(pickCrime('user-1'), pickCrime('user-1'));
  const bounty = pickBounty('user-1');
  assert.equal(bounty, pickBounty('user-1'));
  assert.ok(bounty >= 100 && bounty <= 5000 && bounty % 50 === 0);
  const embed = wantedEmbed({ displayName: 'Perp', crime: pickCrime('user-1'), bounty });
  assert.match(embed.title, /W A N T E D/);
  assert.match(embed.fields[0].value, /donuts/);
});

test('pickDonut is deterministic and returns a donut string', () => {
  assert.equal(pickDonut('a:b'), pickDonut('a:b'));
  assert.match(pickDonut('a:b'), /🍩/);
});

test('reportEmbed honors anonymity', () => {
  const named = reportEmbed({ targetLabel: '<@2>', targetId: '2', reason: 'spam', reporterLabel: '<@1>', anonymous: false });
  assert.equal(named.fields.find((f) => f.name === 'Reporter').value, '<@1>');

  const anon = reportEmbed({ targetLabel: '<@2>', targetId: '2', reason: 'spam', reporterLabel: '<@1>', anonymous: true });
  assert.match(anon.fields.find((f) => f.name === 'Reporter').value, /Anonymous/);
  assert.ok(!/<@1>/.test(JSON.stringify(anon)), 'anonymous report never contains the reporter id');
});

test('reportEmbed defaults a blank reason', () => {
  const e = reportEmbed({ targetLabel: 'x', reason: '   ', reporterLabel: 'y', anonymous: false });
  assert.equal(e.fields.find((f) => f.name === 'Reason').value, 'No reason given');
});
