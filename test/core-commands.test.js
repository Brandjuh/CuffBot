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
