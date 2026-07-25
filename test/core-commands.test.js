// Core command smokes. S96 (M17.3 slice D) moved them onto the flat
// `{ command }` shape — the last four commands to convert — and onto
// dispatchCommand where the command has a declarable gate.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import update from '../src/modules/core/commands/update.js';
import help from '../src/modules/core/commands/help.js';
import radioCheck from '../src/modules/core/commands/radio-check.js';
import restart from '../src/modules/core/commands/restart.js';
import { getGuildData } from '../src/core/store.js';
import { fakeMessage } from './fixtures/fake-message.js';

/**
 * A ctx for the ops commands. `admin`/`owner` drive `isAdminOrOwner`, which
 * both !update and !restart check inside run() — the framework's `permission`
 * field cannot express "Administrator OR guild owner".
 */
function opsCtx({ admin = false, owner = false, guildId = '111222333444555666' } = {}) {
  const replies = [];
  const userId = 'u1';
  return {
    replies,
    ctx: {
      guild: { id: guildId, ownerId: owner ? userId : 'someone-else' },
      channel: {
        id: 'chan-1',
        permissionsFor: () => ({ has: (flag) => admin && flag === PermissionFlagsBits.Administrator }),
      },
      member: { id: userId },
      user: { id: userId, username: 'rando' },
      prefix: '!',
      reply: async (p) => {
        replies.push(typeof p === 'string' ? { content: p } : p);
        return { edit: async () => {} };
      },
    },
  };
}

// Only the DENIED path is tested for !update and !restart — each returns
// before spawning anything. Exercising the authorized path would run the real
// self-updater or restart against this repo, which must never happen in tests.

test('update refuses a non-admin, non-owner (no updater spawned)', async () => {
  const { ctx, replies } = opsCtx();
  await update.command.run(ctx, {});
  assert.match(replies[0].content, /Only administrators/);
});

test('restart refuses non-admins without writing a marker (S28)', async () => {
  const { ctx, replies } = opsCtx();
  await restart.command.run(ctx, {});
  assert.match(replies[0].content, /Only administrators/);
  assert.equal(
    getGuildData('111222333444555666', 'updateReport', null),
    null,
    'no marker written',
  );
});

test('the ops gate admits the guild owner even without the Administrator flag', async () => {
  const { isAdminOrOwner } = await import('../src/core/prefix/permissions.js');
  assert.equal(isAdminOrOwner(opsCtx({ owner: true }).ctx), true, 'guild owner');
  assert.equal(isAdminOrOwner(opsCtx({ admin: true }).ctx), true, 'administrator');
  assert.equal(isAdminOrOwner(opsCtx().ctx), false, 'neither');
});

test('help builds the categorized menu, hiding what the viewer cannot use (S43)', async () => {
  const moduleList = [
    {
      name: 'core',
      description: 'core',
      commands: [
        { command: { name: 'radio-check', description: 'ping', args: [] } },
        { command: { name: 'update', description: 'self-update', args: [] } },
      ],
    },
    {
      name: 'enforcement',
      description: 'enf',
      commands: [
        {
          command: {
            name: 'cite',
            description: 'ticket',
            permission: PermissionFlagsBits.ModerateMembers,
            args: [],
          },
        },
      ],
    },
  ];
  const run = async (hasPerms) => {
    const message = fakeMessage({ perms: hasPerms });
    message.client.config = { prefix: '!' };
    message.client.moduleList = moduleList;
    const { buildCtx } = await import('../src/core/prefix/context.js');
    await help.command.run(buildCtx(message, '!'), {});
    return message.sent;
  };

  const memberView = await run(false);
  const memberEmbed = memberView[0].embeds[0];
  assert.match(memberEmbed.data?.title ?? memberEmbed.title, /Command Menu/);
  const memberText = JSON.stringify(memberView.map((r) => r.embeds[0].toJSON?.() ?? r.embeds[0]));
  assert.ok(memberText.includes('!radio-check'), 'public command visible');
  assert.ok(!memberText.includes('!cite'), 'moderation hidden from regular members');
  assert.ok(!memberText.includes('!update'), 'runtime-gated admin command hidden');

  const adminText = JSON.stringify((await run(true)).map((r) => r.embeds[0].toJSON?.() ?? r.embeds[0]));
  assert.ok(adminText.includes('!cite'), 'admins see moderation');
  assert.ok(adminText.includes('!update'), 'admins see runtime-gated commands');
  assert.ok(adminText.includes('Setup & Admin'), 'admin category present');
});

test('radio-check reports the text-command channel state (S26)', async () => {
  const run = async (messageContentAvailable) => {
    const message = fakeMessage();
    message.client.messageContentAvailable = messageContentAvailable;
    message.client.memberEventsAvailable = true;
    message.createdTimestamp = 1_000;
    const edits = [];
    message.reply = async () => ({
      createdTimestamp: 1_050,
      edit: async (body) => edits.push(body),
    });
    const { buildCtx } = await import('../src/core/prefix/context.js');
    await radioCheck.command.run(buildCtx(message, '!'), {});
    return edits[0];
  };
  const on = await run(true);
  assert.match(on, /✅ Text commands/);
  assert.match(on, /50 ?ms|\d+ ?ms/, 'the measured latency is reported');

  const off = await run(false);
  assert.match(off, /❌ ALL commands are OFF/);
  assert.match(off, /Message Content Intent/);
});
