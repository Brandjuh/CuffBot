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

// S98 (M19): !help is ONE message with a button per category now, not a
// sequence of embed pages. The S43 viewer filter still decides what a member
// sees — and now also which buttons they are offered.

const HELP_MODULES = [
  {
    name: 'core',
    description: 'core',
    commands: [
      { command: { name: 'radiocheck', description: 'ping', args: [] } },
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

async function runHelp(hasPerms) {
  const message = fakeMessage({ perms: hasPerms });
  message.client.config = { prefix: '!' };
  message.client.moduleList = HELP_MODULES;
  const { buildCtx } = await import('../src/core/prefix/context.js');
  await help.command.run(buildCtx(message, '!'), {});
  return message.sent;
}

const payloadText = (payload) =>
  JSON.stringify({
    embeds: payload.embeds.map((e) => e.toJSON?.() ?? e),
    components: payload.components.map((c) => c.toJSON?.() ?? c),
  });

test('help posts ONE message with a button per category (S98)', async () => {
  const sent = await runHelp(true);
  assert.equal(sent.length, 1, 'one message — the page spam is gone');
  const embed = sent[0].embeds[0];
  assert.match(embed.data?.title ?? embed.title, /Command Menu/);
  assert.ok(sent[0].components.length >= 1, 'at least one button row');

  const text = payloadText(sent[0]);
  // The landing view names the categories and their counts, so the buttons
  // are self-explanatory rather than a row of unlabelled guesses.
  assert.ok(text.includes('Moderation'), 'moderation category offered to an admin');
  assert.ok(text.includes('Setup & Admin'), 'admin category offered to an admin');
});

test('the buttons a viewer is offered follow the S43 filter', async () => {
  const memberText = payloadText((await runHelp(false))[0]);
  assert.ok(!memberText.includes('Moderation'), 'no button for a category they cannot use');

  const adminText = payloadText((await runHelp(true))[0]);
  assert.ok(adminText.includes('Moderation'), 'admins get the moderation button');
});

test('a category view lists that category’s commands, filtered per viewer', async () => {
  const { helpCategory } = await import('../src/core/help.js');
  const { buildViewerHelp } = await import('../src/modules/core/lib/help-menu.js');
  const { buildCtx } = await import('../src/core/prefix/context.js');

  const view = async (hasPerms, key) => {
    const message = fakeMessage({ perms: hasPerms });
    message.client.config = { prefix: '!' };
    const model = buildViewerHelp(buildCtx(message, '!'), '!', HELP_MODULES);
    return helpCategory(model, key);
  };

  const adminMod = await view(true, 'moderation');
  assert.match(JSON.stringify(adminMod.fields), /!cite/);

  assert.equal(await view(false, 'moderation'), null, 'a member has no moderation view at all');

  const memberInfo = await view(false, 'info');
  assert.match(JSON.stringify(memberInfo.fields), /!radiocheck/);
  assert.doesNotMatch(JSON.stringify(memberInfo.fields), /!update/, 'runtime-gated stays hidden');
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
