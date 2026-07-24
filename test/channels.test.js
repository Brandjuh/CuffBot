import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSendableChannel } from '../src/core/channels.js';

const sendable = (id) => ({ id, send: async () => {} });

function guildWith({ cached = [], fetchable = {} } = {}) {
  return {
    channels: {
      cache: new Map(cached.map((c) => [c.id, c])),
      fetch: async (id) => {
        if (id in fetchable) return fetchable[id];
        throw new Error('Unknown Channel');
      },
    },
  };
}

test('resolveSendableChannel returns a cached sendable channel', async () => {
  const channel = sendable('c1');
  assert.equal(await resolveSendableChannel(guildWith({ cached: [channel] }), 'c1'), channel);
});

test('resolveSendableChannel falls back to the API on a cache miss (S55)', async () => {
  const channel = sendable('c2');
  const guild = guildWith({ fetchable: { c2: channel } });
  assert.equal(await resolveSendableChannel(guild, 'c2'), channel, 'fetched, not silently dropped');
});

test('resolveSendableChannel rejects non-postable channels and unknown ids', async () => {
  const category = { id: 'cat', type: 4 }; // no .send
  const guild = guildWith({ cached: [category], fetchable: {} });
  assert.equal(await resolveSendableChannel(guild, 'cat'), null, 'a category is not a post target');
  assert.equal(await resolveSendableChannel(guild, 'ghost'), null, 'cache+API miss → null, no throw');
});

test('resolveSendableChannel survives a guild without channels.fetch and empty inputs', async () => {
  const channel = sendable('c3');
  const cacheOnly = { channels: { cache: new Map([['c3', channel]]) } };
  assert.equal(await resolveSendableChannel(cacheOnly, 'c3'), channel);
  assert.equal(await resolveSendableChannel(cacheOnly, 'missing'), null);
  assert.equal(await resolveSendableChannel(null, 'c3'), null);
  assert.equal(await resolveSendableChannel(cacheOnly, null), null);
});
