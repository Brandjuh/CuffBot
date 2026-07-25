// The flat command shape (S93 = M17.3 slice A): dispatch, the permission gate
// that finally names the right permission, the arg bounds that replaced the
// slash builders' setMinValue/setMaxValue, and the token slotting that lets a
// greedy arg sit before an optional trailing flag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { commandUsage, dispatchCommand } from '../src/core/prefix/command.js';
import { permissionLabel, refusalFor } from '../src/core/prefix/permissions.js';
import { resolveSubArgs, splitKeywordArgs } from '../src/core/prefix/group.js';
import { fakeMessage, fakeUser } from './fixtures/fake-message.js';

const MEMBER = '700000000000000042';

const echo = (overrides = {}) => ({
  name: 'echo',
  description: 'Say it back.',
  args: [{ name: 'text', type: 'string', greedy: true, required: true }],
  run: async (ctx, { text }) => ctx.reply(`echo: ${text}`),
  ...overrides,
});

test('dispatch runs the happy path and reports it', async () => {
  const message = fakeMessage();
  const outcome = await dispatchCommand(echo(), message, ['hello', 'there'], '!');
  assert.equal(outcome, 'ran');
  assert.equal(message.sent[0].content, 'echo: hello there');
  assert.deepEqual(message.sent[0].allowedMentions, { repliedUser: false });
});

test('a missing required arg is a usage error carrying the usage line', async () => {
  const message = fakeMessage();
  const outcome = await dispatchCommand(echo(), message, [], '!');
  assert.equal(outcome, 'usage-error');
  assert.match(message.sent[0].content, /missing `text`/);
  assert.match(message.sent[0].content, /!echo <text…>/);
});

test('a crashing run() answers in theme and does not throw', async () => {
  const message = fakeMessage();
  const boom = echo({ run: async () => { throw new Error('kaboom'); } });
  const outcome = await dispatchCommand(boom, message, ['x'], '!');
  assert.equal(outcome, 'crashed');
  assert.match(message.sent[0].content, /Dispatch, we have a malfunction/);
});

// ── the permission gate ──────────────────────────────────────────────────────

test('the refusal names the permission that was actually required', async () => {
  for (const [flag, label] of [
    [PermissionFlagsBits.ManageGuild, 'Manage Server'],
    [PermissionFlagsBits.ModerateMembers, 'Moderate Members'],
    [PermissionFlagsBits.Administrator, 'Administrator'],
    [PermissionFlagsBits.ManageMessages, 'Manage Messages'],
    [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
  ]) {
    assert.equal(permissionLabel(flag), label);
    const message = fakeMessage({ perms: false });
    const outcome = await dispatchCommand(echo({ permission: flag }), message, ['x'], '!');
    assert.equal(outcome, 'refused');
    assert.equal(message.sent[0].content, refusalFor(flag));
    assert.match(message.sent[0].content, new RegExp(label));
  }
});

test('an unmapped flag degrades to a truthful generic phrase', () => {
  assert.equal(permissionLabel(PermissionFlagsBits.AddReactions), 'elevated permissions');
});

test('no permission flag means everybody may run it', async () => {
  const message = fakeMessage({ perms: false });
  assert.equal(await dispatchCommand(echo(), message, ['x'], '!'), 'ran');
});

// ── arg bounds ───────────────────────────────────────────────────────────────

test('integer args honour min/max, and say the range', async () => {
  const spec = { args: [{ name: 'size', type: 'integer', min: 1, max: 25 }] };
  const message = fakeMessage();
  assert.deepEqual((await resolveSubArgs(message, spec, ['10'])).values, { size: 10 });
  assert.match((await resolveSubArgs(message, spec, ['0'])).errors[0], /between 1 and 25/);
  assert.match((await resolveSubArgs(message, spec, ['99'])).errors[0], /between 1 and 25/);
});

test('a one-sided bound reads as at least / at most', async () => {
  const message = fakeMessage();
  const lower = { args: [{ name: 'case', type: 'integer', min: 1 }] };
  const upper = { args: [{ name: 'take', type: 'integer', max: 5 }] };
  assert.match((await resolveSubArgs(message, lower, ['0'])).errors[0], /at least 1/);
  assert.match((await resolveSubArgs(message, upper, ['6'])).errors[0], /at most 5/);
});

test('maxLength refuses an over-long string arg', async () => {
  const spec = { args: [{ name: 'reason', type: 'string', greedy: true, maxLength: 10 }] };
  const message = fakeMessage();
  assert.equal((await resolveSubArgs(message, spec, ['short'])).errors.length, 0);
  assert.match(
    (await resolveSubArgs(message, spec, ['way', 'too', 'long', 'for', 'this'])).errors[0],
    /at most 10 characters/,
  );
});

// ── token slotting around a greedy arg ───────────────────────────────────────

const reportSpec = {
  args: [
    { name: 'target', type: 'user', required: true },
    { name: 'reason', type: 'string', required: true, greedy: true },
    { name: 'anonymous', type: 'boolean' },
  ],
};

test('a trailing optional flag is claimed from the end of the line', async () => {
  const perp = fakeUser(MEMBER);
  const message = fakeMessage({ users: { [MEMBER]: perp } });
  const { values, errors } = await resolveSubArgs(message, reportSpec, [
    MEMBER, 'they', 'keep', 'shouting', 'yes',
  ]);
  assert.deepEqual(errors, []);
  assert.equal(values.reason, 'they keep shouting');
  assert.equal(values.anonymous, true);
});

test('a reason ending in an ordinary word keeps that word', async () => {
  const perp = fakeUser(MEMBER);
  const message = fakeMessage({ users: { [MEMBER]: perp } });
  const { values } = await resolveSubArgs(message, reportSpec, [MEMBER, 'spam', 'in', 'general']);
  assert.equal(values.reason, 'spam in general');
  assert.equal(values.anonymous, undefined);
});

test('the greedy span never eats the args declared before it', async () => {
  const perp = fakeUser(MEMBER);
  const message = fakeMessage({ users: { [MEMBER]: perp } });
  const { values } = await resolveSubArgs(message, reportSpec, [MEMBER, 'only', 'no']);
  assert.equal(values.target.id, MEMBER);
  assert.equal(values.reason, 'only');
  assert.equal(values.anonymous, false);
});

test('greedy-last behaves exactly as it did before the slotting change', async () => {
  const spec = {
    args: [
      { name: 'target', type: 'user', required: true },
      { name: 'reason', type: 'string', greedy: true },
    ],
  };
  const perp = fakeUser(MEMBER);
  const message = fakeMessage({ users: { [MEMBER]: perp } });
  const { values } = await resolveSubArgs(message, spec, [MEMBER, 'a', 'b', 'c']);
  assert.equal(values.reason, 'a b c');
});

// ── usage rendering ──────────────────────────────────────────────────────────

test('usage marks required vs optional and the greedy tail', () => {
  assert.equal(commandUsage('!', echo()), '!echo <text…>');
  assert.equal(commandUsage('!', { name: 'ping', args: [] }), '!ping');
  assert.equal(commandUsage('!', { name: 'x', args: [{ name: 'n', type: 'integer' }] }), '!x [n]');
});

// ── keyword args (S94) ───────────────────────────────────────────────────────
// `!rank-setup header:@[LEVELER]` and `!evidence-locker action:set` are what
// the manuals, STATE's owner-action list and the bot's own replies have told
// people to type since S12 — while the text path was purely positional and
// answered "`header` should be a mention or id".

const keyed = {
  args: [
    { name: 'target', type: 'user', required: true },
    { name: 'reason', type: 'string', required: true, greedy: true },
    { name: 'penalty', type: 'string' },
  ],
};

test('a keyword takes the rest of the line, so its value may have spaces', async () => {
  const message = fakeMessage({ users: { [MEMBER]: fakeUser(MEMBER) } });
  const { values, errors } = await resolveSubArgs(message, keyed, [
    MEMBER, 'loud', 'music', 'penalty:FINAL', 'WARNING',
  ]);
  assert.deepEqual(errors, []);
  assert.equal(values.reason, 'loud music');
  assert.equal(values.penalty, 'FINAL WARNING');
});

test('an optional free-text arg is unreachable positionally — only by keyword', async () => {
  // Every word "fits" a string, so a positional tail token would ambiguously
  // steal the last word of the greedy reason. S93 had this bug; S94 fixed it.
  const message = fakeMessage({ users: { [MEMBER]: fakeUser(MEMBER) } });
  const { values } = await resolveSubArgs(message, keyed, [MEMBER, 'Donut', 'theft']);
  assert.equal(values.reason, 'Donut theft');
  assert.equal(values.penalty, undefined);
});

test('a keyword resolves entity args, which is what !rank-setup header: needs', async () => {
  const ROLE = '701577807070756946';
  const spec = { args: [{ name: 'header', type: 'role' }] };
  const message = fakeMessage({ roles: { [ROLE]: { id: ROLE, name: '[LEVELER]' } } });
  for (const token of [`header:<@&${ROLE}>`, `header:${ROLE}`, `<@&${ROLE}>`]) {
    const { values, errors } = await resolveSubArgs(message, spec, [token]);
    assert.deepEqual(errors, [], token);
    assert.equal(values.header.id, ROLE, token);
  }
});

test('a colon in ordinary text is not a keyword unless it names a declared arg', async () => {
  const message = fakeMessage({ users: { [MEMBER]: fakeUser(MEMBER) } });
  const { values } = await resolveSubArgs(message, keyed, [
    MEMBER, 'posted', 'https://example.com/x', 'at', '10:30',
  ]);
  assert.equal(values.reason, 'posted https://example.com/x at 10:30');
  assert.equal(values.penalty, undefined);
});

test('keywords may appear in any order and still bind by name', async () => {
  const spec = {
    args: [
      { name: 'size', type: 'integer', min: 1, max: 25 },
      { name: 'mode', type: 'string', choices: ['fast', 'slow'] },
    ],
  };
  const message = fakeMessage();
  const { values, errors } = await resolveSubArgs(message, spec, ['mode:slow', 'size:7']);
  assert.deepEqual(errors, []);
  assert.deepEqual(values, { size: 7, mode: 'slow' });
});

test('a keyword still goes through validation — bounds and choices apply', async () => {
  const spec = { args: [{ name: 'size', type: 'integer', min: 1, max: 25 }] };
  const message = fakeMessage();
  assert.match((await resolveSubArgs(message, spec, ['size:99'])).errors[0], /between 1 and 25/);
});

test('splitKeywordArgs leaves a keyword-free line completely alone', () => {
  const specs = keyed.args;
  assert.deepEqual(splitKeywordArgs(specs, ['a', 'b', 'c']), {
    positional: ['a', 'b', 'c'],
    keyed: {},
  });
});
