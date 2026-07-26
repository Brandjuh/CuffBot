// The Red-style group command framework (S69 = M17.1): parsing, arg
// resolution, the bare-!group overview, permission gates, and dispatch — all
// against fake messages, no gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import {
  buildGroupOverview,
  dispatchGroup,
  resolveSubArgs,
  subUsage, gateFor } from '../src/core/prefix/group.js';

const PERM = 32n; // ManageGuild's flag value — the framework only ever calls perms.has(flag)

function fakeMessage({ perms = true, roles = {}, channels = {}, users = {} } = {}) {
  const sent = [];
  const push = (via, p) => {
    sent.push({ via, ...(typeof p === 'string' ? { content: p } : p) });
    return { id: 'sent' };
  };
  return {
    sent,
    author: { id: 'u1', bot: false },
    member: { id: 'u1' },
    client: {
      users: {
        fetch: async (id) => {
          if (users[id]) return users[id];
          throw new Error('unknown user');
        },
      },
    },
    guild: {
      id: '900000000000000001',
      roles: { cache: new Map(Object.entries(roles)), fetch: async (id) => roles[id] ?? null },
      channels: { cache: new Map(Object.entries(channels)), fetch: async (id) => channels[id] ?? null },
    },
    channel: {
      id: 'chan-1',
      permissionsFor: () => ({ has: () => perms }),
      send: async (p) => push('send', p),
    },
    mentions: { users: { get: (id) => users[id] } },
    reply: async (p) => push('reply', p),
  };
}

const makeGroup = (overrides = {}) => ({
  name: 'signal',
  description: 'Radio signal settings.',
  emoji: '📡',
  subcommands: [
    {
      name: 'on',
      aliases: ['enable'],
      description: 'Turn it on.',
      args: [],
      run: async (ctx) => ctx.reply('on!'),
    },
    {
      name: 'volume',
      description: 'Set the volume.',
      args: [{ name: 'level', type: 'integer', required: true }],
      run: async (ctx, values) => ctx.reply(`vol ${values.level}`),
    },
  ],
  ...overrides,
});

// ── subUsage ─────────────────────────────────────────────────────────────────

test('subUsage renders required <>, optional [], and greedy …', () => {
  const sub = {
    name: 'say',
    args: [
      { name: 'channel', type: 'channel', required: true },
      { name: 'text', type: 'string', required: false, greedy: true },
    ],
  };
  assert.equal(subUsage('!', 'radio', sub), '!radio say <channel> [text…]');
  assert.equal(subUsage('!', 'radio', { name: 'on', args: [] }), '!radio on');
});

// ── resolveSubArgs ───────────────────────────────────────────────────────────

test('resolveSubArgs: typed values, greedy tail, booleans in both languages', async () => {
  const sub = {
    name: 'x',
    args: [
      { name: 'count', type: 'integer', required: true },
      { name: 'loud', type: 'boolean', required: true },
      { name: 'text', type: 'string', required: true, greedy: true },
    ],
  };
  const { values, errors } = await resolveSubArgs(null, sub, ['3', 'ja', 'hello', 'there', 'world']);
  assert.deepEqual(errors, []);
  assert.equal(values.count, 3);
  assert.equal(values.loud, true);
  assert.equal(values.text, 'hello there world', 'greedy last arg absorbs the rest');

  const off = await resolveSubArgs(null, sub, ['7', 'nee', 'x']);
  assert.equal(off.values.loud, false, 'Dutch nee works (owner writes Dutch)');
});

test('resolveSubArgs: missing required, bad types, choices', async () => {
  const sub = {
    name: 'x',
    args: [
      { name: 'mode', type: 'string', required: true, choices: ['words', 'reactions'] },
      { name: 'count', type: 'integer', required: false },
    ],
  };
  const missing = await resolveSubArgs(null, sub, []);
  assert.match(missing.errors[0], /missing `mode`/);

  const badChoice = await resolveSubArgs(null, sub, ['shouting']);
  assert.match(badChoice.errors[0], /must be one of: words, reactions/);

  const upper = await resolveSubArgs(null, sub, ['WORDS']);
  assert.deepEqual(upper.errors, []);
  assert.equal(upper.values.mode, 'words', 'choices match case-insensitively');

  const badInt = await resolveSubArgs(null, sub, ['words', 'many']);
  assert.match(badInt.errors[0], /must be a whole number/);

  const optionalSkipped = await resolveSubArgs(null, sub, ['words']);
  assert.deepEqual(optionalSkipped.errors, []);
  assert.ok(!('count' in optionalSkipped.values));
});

test('a postable channel arg refuses categories/voice, accepts text + news (S70)', async () => {
  const sub = { name: 'x', args: [{ name: 'channel', type: 'channel', required: true, postable: true }] };
  const run = async (type) => {
    const chan = { id: '451095508560379934', type };
    const message = fakeMessage({ channels: { [chan.id]: chan } });
    return resolveSubArgs(message, sub, [`<#${chan.id}>`]);
  };
  assert.match((await run(4)).errors[0], /must be a text or announcement channel/, 'category refused');
  assert.match((await run(2)).errors[0], /must be a text or announcement channel/, 'voice refused');
  assert.deepEqual((await run(0)).errors, [], 'text accepted');
  assert.deepEqual((await run(5)).errors, [], 'announcement accepted (S55)');
});

test('resolveSubArgs resolves role/channel/user mentions and raw ids', async () => {
  const role = { id: '625326875442675763', name: 'Squad' };
  const chan = { id: '451095508560379934', name: 'memorial' };
  const user = { id: '411157175948541954', username: 'chief' };
  const message = fakeMessage({
    roles: { [role.id]: role },
    channels: { [chan.id]: chan },
    users: { [user.id]: user },
  });
  const sub = {
    name: 'x',
    args: [
      { name: 'role', type: 'role', required: true },
      { name: 'channel', type: 'channel', required: true },
      { name: 'member', type: 'user', required: true },
    ],
  };
  const mentions = await resolveSubArgs(message, sub, [
    `<@&${role.id}>`,
    `<#${chan.id}>`,
    `<@${user.id}>`,
  ]);
  assert.deepEqual(mentions.errors, []);
  assert.equal(mentions.values.role, role);
  assert.equal(mentions.values.channel, chan);
  assert.equal(mentions.values.member, user);

  const rawIds = await resolveSubArgs(message, sub, [role.id, chan.id, user.id]);
  assert.deepEqual(rawIds.errors, []);
  assert.equal(rawIds.values.role, role);

  const unknown = await resolveSubArgs(message, sub, ['<@&999999999999999999>', chan.id, user.id]);
  assert.match(unknown.errors[0], /could not find role/);

  const junk = await resolveSubArgs(message, sub, ['not-a-role', chan.id, user.id]);
  assert.match(junk.errors[0], /`role` must be a role/);
});

// ── buildGroupOverview ───────────────────────────────────────────────────────

test('buildGroupOverview lists status lines and every subcommand with usage', () => {
  const embed = buildGroupOverview(makeGroup(), { prefix: '!' }, ['**Enabled:** yes']);
  const json = embed.toJSON();
  assert.equal(json.title, '📡 !signal');
  assert.match(json.description, /Radio signal settings\./);
  assert.match(json.description, /\*\*Enabled:\*\* yes/);
  assert.match(json.description, /`!signal on` — Turn it on\./);
  assert.match(json.description, /`!signal volume <level>` — Set the volume\./);
});

// ── dispatchGroup ────────────────────────────────────────────────────────────

test('bare !group replies with the status overview', async () => {
  const group = makeGroup({ status: async () => ['**Enabled:** yes'] });
  const message = fakeMessage();
  assert.equal(await dispatchGroup(group, message, [], '!'), 'overview');
  const embed = message.sent[0].embeds[0].toJSON();
  assert.match(embed.description, /\*\*Enabled:\*\* yes/);
  assert.match(embed.description, /`!signal on`/);
});

test('a crashing status() still renders the overview (without status lines)', async () => {
  const group = makeGroup({
    status: async () => {
      throw new Error('store on fire');
    },
  });
  const message = fakeMessage();
  assert.equal(await dispatchGroup(group, message, [], '!'), 'overview');
  assert.match(message.sent[0].embeds[0].toJSON().description, /`!signal on`/);
});

test('unknown subcommand shows the overview with a hint footer', async () => {
  const message = fakeMessage();
  assert.equal(await dispatchGroup(makeGroup(), message, ['explode'], '!'), 'overview');
  const embed = message.sent[0].embeds[0].toJSON();
  assert.match(embed.footer.text, /Unknown subcommand "explode"/);
});

test('subcommands run with resolved values; aliases work', async () => {
  const message = fakeMessage();
  assert.equal(await dispatchGroup(makeGroup(), message, ['volume', '7'], '!'), 'ran');
  assert.equal(message.sent[0].content, 'vol 7');

  const aliased = fakeMessage();
  assert.equal(await dispatchGroup(makeGroup(), aliased, ['ENABLE'], '!'), 'ran');
  assert.equal(aliased.sent[0].content, 'on!', 'alias + case-insensitive');
});

test('arg errors reply the usage line instead of running', async () => {
  const message = fakeMessage();
  assert.equal(await dispatchGroup(makeGroup(), message, ['volume', 'loud'], '!'), 'usage-error');
  assert.match(message.sent[0].content, /must be a whole number/);
  assert.match(message.sent[0].content, /Usage: `!signal volume <level>`/);
});

test('group permission gates the overview AND the subcommands', async () => {
  const group = makeGroup({ permission: PERM });
  const denied = fakeMessage({ perms: false });
  assert.equal(await dispatchGroup(group, denied, [], '!'), 'refused');
  assert.match(denied.sent[0].content, /🚫 You need \*\*Manage Server\*\*/);

  const deniedSub = fakeMessage({ perms: false });
  assert.equal(await dispatchGroup(group, deniedSub, ['on'], '!'), 'refused');

  const allowed = fakeMessage({ perms: true });
  assert.equal(await dispatchGroup(group, allowed, ['on'], '!'), 'ran');
});

test('a per-subcommand permission overrides the open group', async () => {
  const group = makeGroup();
  group.subcommands[0].permission = PERM;
  const denied = fakeMessage({ perms: false });
  assert.equal(await dispatchGroup(group, denied, [], '!'), 'overview', 'open group: overview visible');
  assert.equal(await dispatchGroup(group, denied, ['on'], '!'), 'refused', 'gated sub refuses');
  assert.equal(await dispatchGroup(group, denied, ['volume', '3'], '!'), 'ran', 'open sub still runs');
});

test('a group fallback sub receives the whole token list (S71)', async () => {
  const group = makeGroup({ fallback: 'volume' });
  const message = fakeMessage();
  assert.equal(await dispatchGroup(group, message, ['8'], '!'), 'ran');
  assert.equal(message.sent[0].content, 'vol 8', '`!signal 8` routed into volume');

  const named = fakeMessage();
  assert.equal(await dispatchGroup(group, named, ['on'], '!'), 'ran');
  assert.equal(named.sent[0].content, 'on!', 'a named sub still wins over the fallback');

  const bare = fakeMessage();
  assert.equal(await dispatchGroup(group, bare, [], '!'), 'overview', 'bare stays the overview');
});

test('a crashing run() answers the standard malfunction apology', async () => {
  const group = makeGroup();
  group.subcommands[0].run = async () => {
    throw new Error('boom');
  };
  const message = fakeMessage();
  assert.equal(await dispatchGroup(group, message, ['on'], '!'), 'crashed');
  assert.match(message.sent[0].content, /📻 Dispatch, we have a malfunction/);
});

test('replies never ping the invoker (S54: allowedMentions suppressed)', async () => {
  const message = fakeMessage();
  await dispatchGroup(makeGroup(), message, ['on'], '!');
  // The group's own reply() decorates payloads; the sub replied plain text
  // through ctx.reply, which must have injected the no-ping allowedMentions.
  assert.deepEqual(message.sent[0].allowedMentions, { repliedUser: false });
});

test('reply falls back to channel.send when message.reply fails (deleted invocation)', async () => {
  const message = fakeMessage();
  message.reply = async () => {
    throw new Error('Unknown message');
  };
  await dispatchGroup(makeGroup(), message, ['on'], '!');
  assert.equal(message.sent[0].via, 'send');
  assert.equal(message.sent[0].content, 'on!');
});

// ── S106: Red's invoke_without_command, and per-viewer group cards ───────────

test('a group with invokeWithoutSubcommand RUNS its fallback when typed bare', async () => {
  // Folding `!donut-board` into `!donuts` must not turn `!donuts` into a menu.
  // This is the flag that keeps the parent command doing its job.
  const ran = [];
  const group = {
    name: 'donuts',
    description: 'balances',
    fallback: 'balance',
    invokeWithoutSubcommand: true,
    status: () => ['never shown'],
    subcommands: [
      { name: 'balance', description: 'yours', args: [], run: async (ctx) => { ran.push('balance'); await ctx.reply('10 donuts'); } },
      { name: 'board', description: 'rich list', args: [], run: async (ctx) => { ran.push('board'); await ctx.reply('the board'); } },
    ],
  };

  const bare = fakeMessage();
  assert.equal(await dispatchGroup(group, bare, [], '!'), 'ran');
  assert.deepEqual(ran, ['balance']);
  assert.equal(bare.sent[0].content, '10 donuts', 'not an overview');

  // A named subcommand still wins over the fallback.
  const named = fakeMessage();
  await dispatchGroup(group, named, ['board'], '!');
  assert.deepEqual(ran, ['balance', 'board']);

  // And an unmatched token still routes into the fallback with ALL tokens (S71).
  const withArg = fakeMessage();
  await dispatchGroup(group, withArg, ['@someone'], '!');
  assert.deepEqual(ran, ['balance', 'board', 'balance']);
});

test('`!group help` always shows the card, even when bare runs something', async () => {
  // A family whose bare form runs a command has no other way to list itself,
  // so `help` is reserved. Red reaches the same place via `[p]help <group>`.
  const group = {
    name: 'donuts',
    description: 'balances',
    fallback: 'balance',
    invokeWithoutSubcommand: true,
    subcommands: [
      { name: 'balance', description: 'yours', args: [], run: async (ctx) => ctx.reply('10 donuts') },
      { name: 'board', description: 'rich list', args: [], run: async () => {} },
    ],
  };
  const message = fakeMessage();
  assert.equal(await dispatchGroup(group, message, ['help'], '!'), 'overview');
  const card = JSON.stringify(message.sent[0].embeds[0]);
  assert.match(card, /donuts board/);
  assert.match(card, /donuts balance/);
});

test('a group may name its own `help` sub, which then wins over the reserved one', async () => {
  let ran = false;
  const group = {
    name: 'thing',
    description: 'x',
    subcommands: [{ name: 'help', description: 'custom', args: [], run: async () => { ran = true; } }],
  };
  assert.equal(await dispatchGroup(group, fakeMessage(), ['help'], '!'), 'ran');
  assert.equal(ran, true);
});

test('the group card lists only what THIS member may run', async () => {
  // S106: folding public commands into admin groups makes "open group, gated
  // subs" the normal shape, and a card that advertises refusals is worse than
  // a short one.
  const group = {
    name: 'xp',
    description: 'xp system',
    permission: PermissionFlagsBits.ManageGuild,
    subcommands: [
      { name: 'ladder', description: 'public list', permission: null, args: [], run: async () => {} },
      { name: 'base', description: 'admin knob', args: [], run: async () => {} },
    ],
  };

  const admin = fakeMessage({ perms: true });
  await dispatchGroup(group, admin, [], '!');
  const adminCard = JSON.stringify(admin.sent[0].embeds[0]);
  assert.match(adminCard, /xp ladder/);
  assert.match(adminCard, /xp base/);

  // A member cannot even see the group's card — the group itself is gated…
  const member = fakeMessage({ perms: false });
  assert.equal(await dispatchGroup(group, member, [], '!'), 'refused');
  // …but `permission: null` really does open the one public sub to them.
  const reader = fakeMessage({ perms: false });
  assert.equal(await dispatchGroup(group, reader, ['ladder'], '!'), 'ran');
  assert.equal(await dispatchGroup(group, fakeMessage({ perms: false }), ['base'], '!'), 'refused');
});

test('an explicit `permission: null` on a sub beats the group gate; undefined inherits it', () => {
  const group = { name: 'g', permission: PermissionFlagsBits.ManageGuild, subcommands: [] };
  assert.equal(gateFor(group, { name: 'open', permission: null }), null, 'null means public');
  assert.equal(gateFor(group, { name: 'inherit' }), PermissionFlagsBits.ManageGuild);
  assert.equal(
    gateFor(group, { name: 'raised', permission: PermissionFlagsBits.Administrator }),
    PermissionFlagsBits.Administrator,
  );
});
