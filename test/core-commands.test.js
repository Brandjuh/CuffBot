import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MessageFlags } from 'discord.js';
import update from '../src/modules/core/commands/update.js';
import help from '../src/modules/core/commands/help.js';

// Only the DENIED path is tested — it returns before triggerUpdate(), so no
// updater process is spawned. Exercising the authorized path would actually
// run the self-updater against this repo, which must never happen in tests.
test('update refuses a non-admin, non-owner (no updater spawned)', async () => {
  const replies = [];
  const ix = {
    user: { id: 'u1', username: 'rando' },
    guild: { ownerId: 'someone-else' },
    memberPermissions: { has: () => false },
    reply: async (p) => replies.push(p),
  };
  await update.execute(ix);
  assert.match(replies[0].content, /Only administrators/);
  assert.equal(replies[0].flags, MessageFlags.Ephemeral);
});

test('help builds a roster embed from the loaded modules', async () => {
  const replies = [];
  const ix = {
    client: {
      config: { prefix: '!' },
      moduleList: [
        {
          name: 'core',
          description: 'core',
          commands: [{ data: { toJSON: () => ({ name: 'radio-check', description: 'ping', options: [] }) } }],
        },
      ],
    },
    reply: async (p) => replies.push(p),
  };
  await help.execute(ix);
  const embed = replies[0].embeds[0];
  const title = embed.data?.title ?? embed.title;
  assert.match(title, /Command Roster/);
});

test('/radio-check reports the text-command channel state (S26)', async () => {
  const { default: radioCheck } = await import('../src/modules/core/commands/radio-check.js');
  const assert = (await import('node:assert/strict')).default;
  const run = async (messageContentAvailable) => {
    const state = { edited: null };
    await radioCheck.execute({
      client: { messageContentAvailable },
      createdTimestamp: 1_000,
      reply: async () => ({ resource: { message: { createdTimestamp: 1_050 } } }),
      editReply: async (p) => (state.edited = p),
    });
    return state.edited;
  };
  assert.match(await run(true), /✅ Text commands/);
  const off = await run(false);
  assert.match(off, /❌ Text commands are OFF/);
  assert.match(off, /Message Content Intent/);
});

test('/restart refuses non-admins without writing a marker (S28)', async () => {
  const { default: restart } = await import('../src/modules/core/commands/restart.js');
  const { getGuildData } = await import('../src/core/store.js');
  const assert = (await import('node:assert/strict')).default;
  const replies = [];
  await restart.execute({
    guild: { id: '111222333444555666', ownerId: 'someone-else' },
    user: { id: 'not-admin', username: 'x' },
    memberPermissions: { has: () => false },
    reply: async (p) => replies.push(p),
  });
  assert.match(replies[0].content, /Only administrators/);
  assert.equal(getGuildData('111222333444555666', 'updateReport', null), null, 'no marker written');
});
// NOTE: the allowed path is deliberately untested — it would trigger a real
// restart/process.exit (same precedent as /update's owner path, S10).
