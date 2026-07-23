import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import detain from '../src/modules/enforcement/commands/detain.js';
import { createMessageInteraction } from '../src/core/prefix/adapter.js';
import { parseCommandLine } from '../src/core/prefix/parse.js';

const TARGET_ID = '411157175948541954';

function fakeMessage(content) {
  const channelSends = [];
  const dmSends = [];
  const target = { id: TARGET_ID, username: 'perp', displayName: 'perp', send: async () => {} };
  const author = { id: '111', username: 'officer', displayName: 'officer', send: async (p) => dmSends.push(p) };
  const message = {
    content,
    author,
    member: { permissions: { has: () => true } },
    guild: { id: 'g1', name: 'Precinct' },
    guildId: 'g1',
    createdTimestamp: 1000,
    channel: {
      sends: channelSends,
      send: async (p) => {
        const msg = { ...(typeof p === 'string' ? { content: p } : p), edit: async () => msg };
        channelSends.push(msg);
        return msg;
      },
      sendTyping: async () => {},
    },
    client: { users: { fetch: async () => target } },
    mentions: { users: new Map([[TARGET_ID, target]]) },
  };
  return { message, channelSends, dmSends, target };
}

test('adapter maps text args onto the interaction option getters', async () => {
  const { message } = fakeMessage(`!detain <@${TARGET_ID}> 1h30m being a repeat offender`);
  const parsed = parseCommandLine(message.content, '!');
  const { errors, interaction } = await createMessageInteraction(message, detain, parsed);
  assert.deepEqual(errors, []);
  assert.equal(interaction.options.getUser('target', true).id, TARGET_ID);
  assert.equal(interaction.options.getString('duration', true), '1h30m');
  assert.equal(interaction.options.getString('reason'), 'being a repeat offender');
  assert.equal(interaction.isChatInputCommand(), false);
  assert.equal(interaction.createdTimestamp, 1000);
});

test('adapter reports missing required args instead of building an interaction', async () => {
  const { message } = fakeMessage('!detain');
  const parsed = parseCommandLine(message.content, '!');
  const { errors, interaction } = await createMessageInteraction(message, detain, parsed);
  assert.ok(errors.length >= 1);
  assert.equal(interaction, null);
});

test('adapter routes a normal reply to the channel', async () => {
  const { message, channelSends } = fakeMessage(`!detain <@${TARGET_ID}> 10m`);
  const parsed = parseCommandLine(message.content, '!');
  const { interaction } = await createMessageInteraction(message, detain, parsed);
  await interaction.reply('🚔 done');
  assert.equal(channelSends.length, 1);
  assert.equal(channelSends[0].content, '🚔 done');
  assert.equal(interaction.replied, true);
});

test('adapter routes an ephemeral reply to the author DM', async () => {
  const { message, channelSends, dmSends } = fakeMessage(`!detain <@${TARGET_ID}> 10m`);
  const parsed = parseCommandLine(message.content, '!');
  const { interaction } = await createMessageInteraction(message, detain, parsed);
  await interaction.reply({ content: 'secret', flags: MessageFlags.Ephemeral });
  assert.equal(dmSends.length, 1);
  assert.equal(dmSends[0].content, 'secret');
  assert.equal(channelSends.length, 0, 'ephemeral output must not hit the channel');
});

test('adapter reply supports withResponse (for /radio-check style latency)', async () => {
  const { message } = fakeMessage(`!detain <@${TARGET_ID}> 10m`);
  const parsed = parseCommandLine(message.content, '!');
  const { interaction } = await createMessageInteraction(message, detain, parsed);
  const res = await interaction.reply({ content: '📻', withResponse: true });
  assert.ok(res.resource.message, 'withResponse returns a resource.message');
});
