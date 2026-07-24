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

test('help builds the categorized menu, hiding what the viewer cannot use (S43)', async () => {
  const moduleList = [
    {
      name: 'core',
      description: 'core',
      commands: [
        { data: { toJSON: () => ({ name: 'radio-check', description: 'ping', options: [] }) } },
        { data: { toJSON: () => ({ name: 'update', description: 'self-update', options: [] }) } },
      ],
    },
    {
      name: 'enforcement',
      description: 'enf',
      commands: [
        {
          data: {
            toJSON: () => ({ name: 'cite', description: 'ticket', options: [], default_member_permissions: '8192' }),
          },
        },
      ],
    },
  ];
  const run = async (hasPerms) => {
    const replies = [];
    await help.execute({
      client: { config: { prefix: '!' }, moduleList },
      memberPermissions: { has: () => hasPerms },
      reply: async (p) => replies.push(p),
      followUp: async (p) => replies.push(p),
    });
    return replies;
  };

  const memberView = await run(false);
  const memberEmbed = memberView[0].embeds[0];
  assert.match(memberEmbed.data?.title ?? memberEmbed.title, /Command Menu/);
  assert.equal(memberView[0].flags, 64, 'help is ephemeral (S39/S43)');
  const memberText = JSON.stringify(memberView.map((r) => r.embeds[0].toJSON?.() ?? r.embeds[0]));
  assert.ok(memberText.includes('/radio-check'), 'public command visible');
  assert.ok(!memberText.includes('/cite'), 'moderation hidden from regular members');
  assert.ok(!memberText.includes('/update'), 'runtime-gated admin command hidden');

  const adminText = JSON.stringify((await run(true)).map((r) => r.embeds[0].toJSON?.() ?? r.embeds[0]));
  assert.ok(adminText.includes('/cite'), 'admins see moderation');
  assert.ok(adminText.includes('/update'), 'admins see runtime-gated commands');
  assert.ok(adminText.includes('Setup & Admin'), 'admin category present');
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
