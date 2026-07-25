// The rules poster (S97 = M18, owner request). Pure list editing and
// pagination, then the publish loop — which is the interesting half: the whole
// point of the feature is that the published post is EDITED in place rather
// than reposted, so the precinct's rules keep one stable link.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { PermissionFlagsBits } from 'discord.js';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  DESCRIPTION_BUDGET,
  MAX_RULE_LENGTH,
  addRule,
  clearRules,
  editRule,
  moveRule,
  normalizeRules,
  paginateRules,
  removeRule,
} from '../src/modules/rules/lib/rules.js';
import {
  buildRulesPayloads,
  getRules,
  publishRules,
  publishedAt,
  setRules,
  setRulesConfig,
} from '../src/modules/rules/service.js';
import rulesCommand from '../src/modules/rules/commands/rules.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-rules-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `30000000000000${String((seq += 1)).padStart(4, '0')}`;

// ── pure list editing ────────────────────────────────────────────────────────

test('adding appends and numbers positionally', () => {
  let rules = [];
  ({ rules } = addRule(rules, 'Be excellent to each other'));
  ({ rules } = addRule(rules, '  No spam  '));
  assert.deepEqual(rules, ['Be excellent to each other', 'No spam'], 'stored trimmed');
  assert.match(addRule(rules, 'Third').message, /rule \*\*3\*\*/);
});

test('an empty or over-long rule is refused without changing the list', () => {
  const rules = ['One'];
  for (const bad of ['', '   ', null]) {
    const result = addRule(rules, bad);
    assert.equal(result.ok, false);
    assert.deepEqual(result.rules, rules, 'the list is untouched on a refusal');
  }
  const tooLong = addRule(rules, 'x'.repeat(MAX_RULE_LENGTH + 1));
  assert.equal(tooLong.ok, false);
  assert.match(tooLong.message, new RegExp(`limit is ${MAX_RULE_LENGTH}`));
});

test('editing keeps the number; removing renumbers everything below', () => {
  const rules = ['A', 'B', 'C'];
  assert.deepEqual(editRule(rules, 2, 'B2').rules, ['A', 'B2', 'C']);

  const removed = removeRule(rules, 2);
  assert.deepEqual(removed.rules, ['A', 'C']);
  // The renumbering is the surprising part, so the reply states it.
  assert.match(removed.message, /moved up one/);

  const last = removeRule(['A', 'B'], 2);
  assert.doesNotMatch(last.message, /moved up/, 'nothing below the last rule to move');
});

test('a number outside the book is refused, and says the real range', () => {
  const rules = ['A', 'B'];
  for (const n of [0, 3, 99, 1.5]) {
    const result = editRule(rules, n, 'x');
    assert.equal(result.ok, false, `rule ${n}`);
    assert.match(result.message, /runs 1–2/);
  }
  assert.match(editRule([], 1, 'x').message, /no rules yet/);
});

test('moving reorders and reports the new position', () => {
  assert.deepEqual(moveRule(['A', 'B', 'C'], 3, 1).rules, ['C', 'A', 'B']);
  assert.deepEqual(moveRule(['A', 'B', 'C'], 1, 3).rules, ['B', 'C', 'A']);
  assert.equal(moveRule(['A', 'B'], 1, 1).ok, false, 'a no-op move is refused');
});

test('clearing needs something to clear', () => {
  assert.deepEqual(clearRules(['A']).rules, []);
  assert.equal(clearRules([]).ok, false);
});

test('normalizeRules survives whatever is in storage', () => {
  assert.deepEqual(normalizeRules(null), []);
  assert.deepEqual(normalizeRules('nonsense'), []);
  assert.deepEqual(normalizeRules(['A', '', '  ', null, { text: 'B' }, 42]), ['A', 'B']);
});

// ── pagination ───────────────────────────────────────────────────────────────

test('a short rulebook is one page, with the intro and outro on it', () => {
  const pages = paginateRules(['A', 'B'], { header: 'Read these.', footer: 'Ask a mod.' });
  assert.equal(pages.length, 1);
  assert.match(pages[0].description, /^Read these\./);
  assert.match(pages[0].description, /\*\*1\.\*\* A\n\*\*2\.\*\* B/);
  assert.match(pages[0].description, /Ask a mod\.$/);
});

test('an empty rulebook still renders, saying so', () => {
  const [page] = paginateRules([]);
  assert.match(page.description, /No rules have been written yet/);
});

test('a long rulebook splits between rules, never mid-rule, inside the embed cap', () => {
  const long = Array.from({ length: 40 }, (_, i) => `${'x'.repeat(300)} (rule ${i + 1})`);
  const pages = paginateRules(long, { header: 'Intro', footer: 'Outro' });
  assert.ok(pages.length > 1, 'this cannot fit one embed');
  for (const page of pages) {
    assert.ok(page.description.length <= 4096, `page of ${page.description.length} chars`);
  }
  // Every rule appears exactly once, and only at a line start.
  const all = pages.map((p) => p.description).join('\n');
  for (let i = 1; i <= long.length; i += 1) {
    assert.equal(
      all.split(`**${i}.** `).length - 1,
      1,
      `rule ${i} appears exactly once, whole`,
    );
  }
  assert.match(pages[0].description, /^Intro/, 'intro opens page one only');
  assert.match(pages.at(-1).description, /Outro$/, 'outro closes the last page only');
  assert.doesNotMatch(pages[1].description, /^Intro/);
});

test('one rule longer than a page is still emitted whole (no silent truncation)', () => {
  const [page] = paginateRules(['y'.repeat(DESCRIPTION_BUDGET + 500)]);
  assert.ok(page.description.includes('y'.repeat(DESCRIPTION_BUDGET + 500)));
});

// ── publishing: edit in place ────────────────────────────────────────────────

/** A guild whose channel records what was sent, edited and deleted. */
function fakeGuild(guildId, { channelId = 'rules-chan' } = {}) {
  const sent = [];
  const edits = [];
  const deleted = [];
  let nextId = 1;
  const store = new Map();
  const channel = {
    id: channelId,
    type: 0,
    isTextBased: () => true,
    viewable: true,
    send: async (payload) => {
      const id = `msg-${nextId++}`;
      sent.push({ id, payload });
      const message = { id, edit: async (p) => (edits.push({ id, payload: p }), message) };
      store.set(id, message);
      return message;
    },
    messages: {
      fetch: async (id) => {
        const message = store.get(id);
        if (!message) throw new Error('unknown message');
        return message;
      },
      delete: async (id) => {
        deleted.push(id);
        store.delete(id);
      },
    },
    permissionsFor: () => ({ has: () => true }),
  };
  const channels = new Map([[channelId, channel]]);
  return {
    sent,
    edits,
    deleted,
    channel,
    guild: {
      id: guildId,
      members: { me: {} },
      channels: { cache: channels, fetch: async (id) => channels.get(id) ?? null },
    },
    addChannel: (id) => {
      const extra = { ...channel, id, messages: channel.messages };
      channels.set(id, extra);
      return extra;
    },
  };
}

test('publishing posts once, then EDITS in place — the whole point of the feature', async () => {
  const guildId = freshGuildId();
  const world = fakeGuild(guildId);
  setRulesConfig(guildId, { channelId: 'rules-chan' });
  setRules(guildId, ['No spam']);

  assert.equal(await publishRules(world.guild), 'posted');
  assert.equal(world.sent.length, 1);
  assert.equal(publishedAt(guildId).messageIds.length, 1);

  setRules(guildId, ['No spam', 'Be kind']);
  assert.equal(await publishRules(world.guild), 'edited');
  assert.equal(world.sent.length, 1, 'still exactly one message in the channel');
  assert.equal(world.edits.length, 1, 'it was edited, not reposted');
  assert.match(JSON.stringify(world.edits[0].payload), /Be kind/);
});

test('a rulebook that outgrows one embed adds pages, and gives them back when it shrinks', async () => {
  const guildId = freshGuildId();
  const world = fakeGuild(guildId);
  setRulesConfig(guildId, { channelId: 'rules-chan' });

  setRules(guildId, Array.from({ length: 30 }, (_, i) => `${'z'.repeat(300)} #${i}`));
  await publishRules(world.guild);
  const grown = publishedAt(guildId).messageIds.length;
  assert.ok(grown > 1, 'more than one page');

  setRules(guildId, ['Just the one now']);
  await publishRules(world.guild);
  assert.equal(publishedAt(guildId).messageIds.length, 1);
  assert.equal(world.deleted.length, grown - 1, 'the surplus pages were removed');
});

test('a deleted post is replaced rather than lost', async () => {
  const guildId = freshGuildId();
  const world = fakeGuild(guildId);
  setRulesConfig(guildId, { channelId: 'rules-chan' });
  setRules(guildId, ['One']);
  await publishRules(world.guild);

  // Someone deletes the bot's message by hand.
  await world.channel.messages.delete(publishedAt(guildId).messageIds[0]);
  assert.equal(await publishRules(world.guild), 'posted', 'it notices and reposts');
  assert.equal(world.sent.length, 2);
});

test('moving the rulebook to another channel cleans up the old copy', async () => {
  const guildId = freshGuildId();
  const world = fakeGuild(guildId);
  setRulesConfig(guildId, { channelId: 'rules-chan' });
  setRules(guildId, ['One']);
  await publishRules(world.guild);
  const oldId = publishedAt(guildId).messageIds[0];

  world.addChannel('new-chan');
  setRulesConfig(guildId, { channelId: 'new-chan' });
  assert.equal(await publishRules(world.guild), 'posted');
  assert.equal(publishedAt(guildId).channelId, 'new-chan');
  assert.ok(world.deleted.includes(oldId), 'the precinct is never left with two rulebooks');
});

test('publishing without a channel says so instead of failing silently', async () => {
  const guildId = freshGuildId();
  const world = fakeGuild(guildId);
  setRules(guildId, ['One']);
  assert.equal(await publishRules(world.guild), 'unconfigured');
  assert.equal(world.sent.length, 0);
});

// ── the command surface ──────────────────────────────────────────────────────

const group = rulesCommand.group;
const sub = (name) => group.subcommands.find((s) => s.name === name);

function fakeCtx(world) {
  const replies = [];
  return {
    replies,
    guild: world.guild,
    channel: world.channel,
    user: { id: 'admin' },
    prefix: '!',
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

test('!rules add stores the rule and republishes in one move', async () => {
  const guildId = freshGuildId();
  const world = fakeGuild(guildId);
  setRulesConfig(guildId, { channelId: 'rules-chan' });
  const ctx = fakeCtx(world);

  await sub('add').run(ctx, { text: 'No spam' });
  assert.deepEqual(getRules(guildId), ['No spam']);
  assert.match(ctx.replies[0].content, /Added as rule \*\*1\*\*/);
  assert.equal(world.sent.length, 1);

  await sub('add').run(ctx, { text: 'Be kind' });
  assert.match(ctx.replies[1].content, /updated/, 'the second add edits the post');
});

test('!rules clear demands the word confirm', async () => {
  const guildId = freshGuildId();
  const world = fakeGuild(guildId);
  setRules(guildId, ['A', 'B']);
  const ctx = fakeCtx(world);

  await sub('clear').run(ctx, {});
  assert.match(ctx.replies[0].content, /Run `!rules clear confirm`/);
  assert.deepEqual(getRules(guildId), ['A', 'B'], 'nothing erased without the word');

  await sub('clear').run(ctx, { confirm: 'confirm' });
  assert.deepEqual(getRules(guildId), []);
});

test('!rules show is public and renders the same pages that get published', async () => {
  const guildId = freshGuildId();
  const world = fakeGuild(guildId);
  setRules(guildId, ['One', 'Two']);
  const ctx = fakeCtx(world);

  assert.equal(sub('show').permission, undefined, 'reading the rules is not gated');
  await sub('show').run(ctx, {});
  assert.deepEqual(
    JSON.stringify(ctx.replies),
    JSON.stringify(buildRulesPayloads(guildId)),
    'what you read is exactly what gets published',
  );
});

test('every mutating subcommand is gated on Manage Server', () => {
  for (const name of ['add', 'edit', 'remove', 'move', 'clear', 'channel', 'title', 'publish']) {
    assert.equal(sub(name).permission, PermissionFlagsBits.ManageGuild, `!rules ${name}`);
  }
});

test('the group status reports the count, the channel and whether it is published', async () => {
  const guildId = freshGuildId();
  const world = fakeGuild(guildId);
  setRulesConfig(guildId, { channelId: 'rules-chan' });
  setRules(guildId, ['One']);
  await publishRules(world.guild);

  const lines = await group.status(fakeCtx(world));
  assert.match(lines.join('\n'), /Rules on the books:\*\* 1/);
  assert.match(lines.join('\n'), /<#rules-chan>/);
  assert.match(lines.join('\n'), /1 message\(s\)/);
});
