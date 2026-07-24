import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { ChannelType } from 'discord.js';
import {
  ACTION_EDIT,
  ACTION_REPOST,
  ACTION_SKIP,
  DEFAULT_HEADER,
  chunkBlocks,
  decideAction,
  formatCategoryHeader,
  formatChannelLine,
  groupByCategory,
  normalizeEmojiInput,
  normalizeTopic,
  parseHexColor,
  renderBlocks,
} from '../src/modules/channellist/lib/list.js';
import {
  DEFAULT_CHANNELLIST_CONFIG,
  collectDescriptors,
  refreshList,
  removeList,
  renderChunks,
  scheduleAutoUpdate,
  setChannellistConfig,
  withListLock,
} from '../src/modules/channellist/service.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-channellist-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `20000000000000${String((seq += 1)).padStart(4, '0')}`;

// ── pure lib ─────────────────────────────────────────────────────────────────

test('topic and line formatting', () => {
  assert.equal(normalizeTopic('  spread \n over\t lines  '), 'spread over lines');
  assert.equal(normalizeTopic(null), '');
  assert.equal(formatChannelLine('<#1>', 'General chat'), '<#1> - General chat');
  assert.equal(formatChannelLine('<#1>', '   '), '<#1>');
  assert.equal(formatCategoryHeader('Info', ''), '**[Info]**');
  assert.equal(formatCategoryHeader('Info', '🚔'), '**[🚔] [Info] [🚔]**');
});

const d = (id, kind, { parentId = null, position = 0, topic = null, visible = true } = {}) => ({
  id,
  kind,
  name: `name-${id}`,
  parentId,
  position,
  topic,
  visible,
  mention: `<#${id}>`,
});

test('groupByCategory mirrors the Discord UI order', () => {
  const grouped = groupByCategory([
    d('cat-b', 'category', { position: 2 }),
    d('cat-a', 'category', { position: 1 }),
    d('top-text', 'text', { position: 0 }),
    d('a-voice', 'voice', { parentId: 'cat-a', position: 0 }),
    d('a-text-2', 'text', { parentId: 'cat-a', position: 5 }),
    d('a-text-1', 'text', { parentId: 'cat-a', position: 1, topic: 'first' }),
    d('b-text', 'text', { parentId: 'cat-b', position: 0 }),
    d('hidden', 'text', { parentId: 'cat-b', position: 1, visible: false }),
    d('orphan', 'text', { parentId: 'gone-cat', position: 9 }),
  ]);
  assert.equal(grouped[0].name, null, 'uncategorized block first, no header');
  assert.deepEqual(grouped[0].entries.map((e) => e.mention), ['<#top-text>', '<#orphan>']);
  assert.equal(grouped[1].name, 'name-cat-a');
  assert.deepEqual(
    grouped[1].entries.map((e) => e.mention),
    ['<#a-text-1>', '<#a-text-2>', '<#a-voice>'],
    'text channels by position, voice after text',
  );
  assert.deepEqual(grouped[2].entries.map((e) => e.mention), ['<#b-text>'], 'hidden channel dropped');
});

test('groupByCategory honors includeVoice and ignores (channel and whole category)', () => {
  const descriptors = [
    d('cat', 'category', { position: 0 }),
    d('t1', 'text', { parentId: 'cat', position: 0 }),
    d('v1', 'voice', { parentId: 'cat', position: 1 }),
    d('cat2', 'category', { position: 1 }),
    d('t2', 'text', { parentId: 'cat2', position: 0 }),
  ];
  const noVoice = groupByCategory(descriptors, { includeVoice: false });
  assert.deepEqual(noVoice.flatMap((g) => g.entries.map((e) => e.mention)), ['<#t1>', '<#t2>']);

  const ignoredChannel = groupByCategory(descriptors, { ignoredIds: ['t1'] });
  assert.deepEqual(ignoredChannel.flatMap((g) => g.entries.map((e) => e.mention)), ['<#v1>', '<#t2>']);

  const ignoredCategory = groupByCategory(descriptors, { ignoredIds: ['cat'] });
  assert.deepEqual(
    ignoredCategory.flatMap((g) => g.entries.map((e) => e.mention)),
    ['<#t2>'],
    'an ignored category hides all its channels',
  );
});

test('renderBlocks + chunkBlocks pack header and blocks with blank-line separators', () => {
  const blocks = renderBlocks(
    [
      { name: null, entries: [{ mention: '<#1>', topic: 'top' }] },
      { name: 'Info', entries: [{ mention: '<#2>', topic: null }] },
    ],
    '',
  );
  const chunks = chunkBlocks('Header text', blocks);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], 'Header text\n\n<#1> - top\n\n**[Info]**\n<#2>');
});

test('chunkBlocks never strands a category header at the bottom of a chunk', () => {
  const blocks = [
    ['**[A]**', '<#1> - aaaaaaaaaa', '<#2> - bbbbbbbbbb'],
    ['**[B]**', '<#3> - cccccccccc'],
  ];
  // Limit chosen so block B's header alone would still fit at the bottom of
  // chunk 1, but header+first-channel does not — the pair must move together.
  const chunks = chunkBlocks('', blocks, 60);
  assert.equal(chunks.length, 2);
  assert.match(chunks[1], /^\*\*\[B\]\*\*\n<#3>/, 'header starts the next chunk with its channels');
  assert.ok(!chunks[0].endsWith('**[B]**'), 'no stranded header');
});

test('decideAction: repost / skip / edit matrix', () => {
  assert.equal(decideAction(['a'], null), ACTION_REPOST, 'nothing usable posted');
  assert.equal(decideAction(['a'], []), ACTION_REPOST, 'empty existing set');
  assert.equal(decideAction(['a', 'b'], ['a']), ACTION_REPOST, 'list grew past the posted messages');
  assert.equal(decideAction(['a', 'b'], ['a', 'b']), ACTION_SKIP, 'identical content');
  assert.equal(decideAction(['a', 'x'], ['a', 'b']), ACTION_EDIT, 'same count, changed content');
  assert.equal(decideAction(['a'], ['a', 'b']), ACTION_EDIT, 'shrunk list edits + deletes extras');
});

test('input normalizers: hex color and emoji', () => {
  assert.equal(parseHexColor('#5865f2'), 0x5865f2);
  assert.equal(parseHexColor('ABC123'), 0xabc123);
  assert.equal(parseHexColor('not-a-color'), null);
  assert.equal(parseHexColor('#12345678'), null);
  assert.equal(normalizeEmojiInput('🚔'), '🚔');
  assert.equal(normalizeEmojiInput(' none '), '');
  assert.equal(normalizeEmojiInput('OFF'), '');
});

// ── service with fakes ───────────────────────────────────────────────────────

const allowAll = () => ({ has: () => true });

function fakeTextChannel(id, { parentId = null, position = 0, topic = null, viewable = true } = {}) {
  return {
    id,
    name: `chan-${id}`,
    type: ChannelType.GuildText,
    parentId,
    rawPosition: position,
    topic,
    permissionsFor: () => ({ has: () => viewable }),
  };
}

function fakeListChannel(id) {
  let messageSeq = 0;
  const store = new Map();
  const channel = {
    id,
    name: `list-${id}`,
    type: ChannelType.GuildText,
    parentId: null,
    rawPosition: 99,
    topic: null,
    sends: [],
    edits: [],
    deletions: [],
    permissionsFor: allowAll,
    send: async (payload) => {
      messageSeq += 1;
      const message = makeMessage(`m${messageSeq}`, payload);
      store.set(message.id, message);
      channel.sends.push(payload);
      return message;
    },
    messages: {
      fetch: async (messageId) => {
        const message = store.get(messageId);
        if (!message) throw new Error('Unknown Message');
        return message;
      },
      delete: async (messageId) => {
        store.delete(messageId);
        channel.deletions.push(messageId);
      },
    },
    store,
  };
  const descriptionOf = (payload) =>
    payload.embeds[0].toJSON?.().description ?? payload.embeds[0].description ?? '';
  const makeMessage = (messageId, payload) => ({
    id: messageId,
    embeds: [{ description: descriptionOf(payload) }],
    edit: async (next) => {
      const message = store.get(messageId);
      message.embeds = [{ description: descriptionOf(next) }];
      channel.edits.push({ messageId, description: descriptionOf(next) });
      return message;
    },
    delete: async () => {
      store.delete(messageId);
      channel.deletions.push(messageId);
    },
  });
  return channel;
}

function fakeGuild(guildId, channels) {
  return {
    id: guildId,
    name: 'Precinct',
    roles: { everyone: { id: 'everyone' }, cache: new Map() },
    members: { me: { id: 'cuffbot' } },
    channels: { cache: new Map(channels.map((c) => [c.id, c])) },
  };
}

test('collectDescriptors + renderChunks list visible channels with topics', () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId, [
    { id: 'cat', name: 'Info', type: ChannelType.GuildCategory, rawPosition: 0 },
    fakeTextChannel('general', { parentId: 'cat', position: 0, topic: 'Daily  chatter' }),
    fakeTextChannel('secret', { parentId: 'cat', position: 1, viewable: false }),
    fakeTextChannel('rules', { position: 0, topic: 'Read me' }),
  ]);
  const descriptors = collectDescriptors(guild, null);
  assert.equal(descriptors.find((x) => x.id === 'secret').visible, false);

  const chunks = renderChunks(guild);
  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /^All public channels/);
  assert.match(chunks[0], /<#rules> - Read me/);
  assert.match(chunks[0], /\*\*\[Info\]\*\*\n<#general> - Daily chatter/);
  assert.ok(!chunks[0].includes('<#secret>'), 'invisible channels stay out');
});

test('refreshList: unconfigured and missing channel results', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId, [fakeTextChannel('a')]);
  assert.equal(await refreshList(guild), 'unconfigured');
  setChannellistConfig(guildId, { channelId: 'gone' });
  assert.equal(await refreshList(guild), 'missing-channel');
});

test('refreshList posts, skips when unchanged, edits on topic change, reposts when a message dies', async () => {
  const guildId = freshGuildId();
  const list = fakeListChannel('list');
  const general = fakeTextChannel('general', { topic: 'First topic' });
  const guild = fakeGuild(guildId, [list, general]);
  setChannellistConfig(guildId, { channelId: 'list' });

  assert.equal(await refreshList(guild), 'posted');
  assert.equal(list.sends.length, 1);
  assert.deepEqual(list.sends[0].allowedMentions, { parse: [] });
  assert.match(list.store.get('m1').embeds[0].description, /<#general> - First topic/);

  assert.equal(await refreshList(guild), 'unchanged', 'identical render skips all writes');
  assert.equal(list.sends.length, 1);

  general.topic = 'Second topic';
  assert.equal(await refreshList(guild), 'edited', 'same message count → edit in place');
  assert.equal(list.edits.length, 1);
  assert.match(list.store.get('m1').embeds[0].description, /Second topic/);

  list.store.delete('m1'); // someone deleted the posted list message
  assert.equal(await refreshList(guild), 'reposted');
  assert.match(list.store.get('m2').embeds[0].description, /Second topic/);

  assert.equal(await refreshList(guild, { forceRepost: true }), 'reposted', 'post action always reposts');
});

test('removeList deletes the posted messages and forgets them', async () => {
  const guildId = freshGuildId();
  const list = fakeListChannel('list');
  const guild = fakeGuild(guildId, [list, fakeTextChannel('general')]);
  setChannellistConfig(guildId, { channelId: 'list' });
  await refreshList(guild);
  assert.equal(await removeList(guild), true);
  assert.equal(list.store.size, 0);
  assert.equal(await removeList(guild), false, 'nothing left to remove');
});

test('scheduleAutoUpdate debounces bursts into one refresh and requires a posted list', async () => {
  const guildId = freshGuildId();
  const list = fakeListChannel('list');
  const general = fakeTextChannel('general', { topic: 'v1' });
  const guild = fakeGuild(guildId, [list, general]);

  assert.equal(scheduleAutoUpdate(guild, { delayMs: 5 }), false, 'nothing posted yet → no auto updates');

  setChannellistConfig(guildId, { channelId: 'list' });
  await refreshList(guild);
  general.topic = 'v2';
  assert.equal(scheduleAutoUpdate(guild, { delayMs: 20 }), true);
  assert.equal(scheduleAutoUpdate(guild, { delayMs: 20 }), true, 'second event re-arms the same timer');
  await new Promise((resolve) => setTimeout(resolve, 60));
  await withListLock(guildId, () => {}); // wait for the refresh holding the lock
  assert.equal(list.edits.length, 1, 'the burst became exactly one edit');
  assert.match(list.store.get('m1').embeds[0].description, /v2/);
});

test('defaults: no list channel invented, auto-update on, voice included', () => {
  assert.equal(DEFAULT_CHANNELLIST_CONFIG.channelId, null);
  assert.equal(DEFAULT_CHANNELLIST_CONFIG.autoUpdate, true);
  assert.equal(DEFAULT_CHANNELLIST_CONFIG.includeVoice, true);
  assert.equal(DEFAULT_CHANNELLIST_CONFIG.header, DEFAULT_HEADER);
});
