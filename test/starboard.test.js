import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  boardModel,
  DEFAULT_STARBOARD_CONFIG,
  isBoarded,
  recordBoarded,
  shouldBoard,
} from '../src/modules/starboard/lib/board.js';
import {
  alreadyBoarded,
  boardMessage,
  getBoardedData,
  setStarboardConfig,
  starboardEmbed,
} from '../src/modules/starboard/service.js';
import starWatch from '../src/modules/starboard/events/star-watch.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-starboard-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `40000000000000${String((seq += 1)).padStart(4, '0')}`;

// ── rules ────────────────────────────────────────────────────────────────────

test('shouldBoard: the full decision matrix', () => {
  const config = { ...DEFAULT_STARBOARD_CONFIG, channelId: 'board' };
  const base = { emojiName: '⭐', count: 3, config, messageChannelId: 'general', alreadyBoarded: false };
  assert.equal(shouldBoard(base).board, true);
  assert.equal(shouldBoard({ ...base, count: 2 }).reason, 'below-threshold');
  assert.equal(shouldBoard({ ...base, emojiName: '👍' }).reason, 'wrong-emoji');
  assert.equal(shouldBoard({ ...base, messageChannelId: 'board' }).reason, 'board-channel');
  assert.equal(shouldBoard({ ...base, alreadyBoarded: true }).reason, 'already-boarded');
  assert.equal(shouldBoard({ ...base, config: { ...config, enabled: false } }).reason, 'disabled');
  assert.equal(shouldBoard({ ...base, config: { ...config, channelId: null } }).reason, 'no-channel');
});

test('boardModel clamps content, picks the first image, and survives empty text', () => {
  const snap = {
    content: 'x'.repeat(2000),
    authorName: 'Brand',
    attachments: [
      { url: 'https://cdn/x.mp4', contentType: 'video/mp4' },
      { url: 'https://cdn/pic.png', contentType: 'image/png' },
    ],
    url: 'https://discord.com/channels/1/2/3',
    channelId: 'general',
    stars: 4,
  };
  const model = boardModel(snap);
  assert.equal(model.content.length, 1000);
  assert.ok(model.content.endsWith('…'));
  assert.equal(model.imageUrl, 'https://cdn/pic.png', 'first IMAGE attachment, not the video');
  const empty = boardModel({ ...snap, content: '  ', attachments: [] });
  assert.match(empty.content, /no text/);
  assert.equal(empty.imageUrl, null);
});

test('recordBoarded bounds the store and drops evicted posts', () => {
  let data = {};
  for (let i = 0; i < 1005; i += 1) data = recordBoarded(data, `m${i}`, `b${i}`);
  assert.equal(data.order.length, 1000);
  assert.equal(isBoarded(data, 'm0'), false, 'oldest evicted');
  assert.equal(isBoarded(data, 'm1004'), true);
});

// ── service ──────────────────────────────────────────────────────────────────

function fakeGuild(guildId, { sendWorks = true } = {}) {
  const sends = [];
  const channel = {
    id: 'board',
    send: async (p) => {
      if (!sendWorks) throw new Error('missing perms');
      sends.push(p);
      return { id: `board-msg-${sends.length}` };
    },
  };
  return { id: guildId, channels: { cache: new Map([['board', channel]]) }, sends };
}

const SNAP = (id = 'm1') => ({
  messageId: id,
  content: 'great police work',
  authorName: 'Brand',
  avatarUrl: null,
  attachments: [],
  url: 'https://discord.com/channels/1/2/3',
  channelId: 'general',
  stars: 3,
});

test('boardMessage posts once, records the board id, and dedupes forever', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  const config = setStarboardConfig(guildId, { channelId: 'board' });
  assert.equal(await boardMessage(guild, SNAP(), config), true);
  assert.equal(guild.sends.length, 1);
  assert.deepEqual(guild.sends[0].allowedMentions, { parse: [] });
  assert.equal(alreadyBoarded(guildId, 'm1'), true);
  assert.equal(getBoardedData(guildId).posts.m1, 'board-msg-1');
  assert.equal(await boardMessage(guild, SNAP(), config), false, 'second call is a no-op');
  assert.equal(guild.sends.length, 1);
});

test('a failed board send rolls back the claim so a later star retries', async () => {
  const guildId = freshGuildId();
  const config = setStarboardConfig(guildId, { channelId: 'board' });
  const broken = fakeGuild(guildId, { sendWorks: false });
  assert.equal(await boardMessage(broken, SNAP('m2'), config), false);
  assert.equal(alreadyBoarded(guildId, 'm2'), false, 'claim rolled back');
  const healthy = fakeGuild(guildId);
  assert.equal(await boardMessage(healthy, SNAP('m2'), config), true);
});

test('starboardEmbed renders author, jump link, stars, and image', () => {
  const embed = starboardEmbed(
    boardModel({ ...SNAP(), attachments: [{ url: 'https://cdn/p.png', contentType: 'image/png' }] }),
  ).toJSON();
  assert.equal(embed.author.name, 'Brand');
  assert.match(embed.description, /great police work/);
  assert.match(embed.description, /Jump to the original/);
  assert.match(embed.footer.text, /⭐ 3/);
  assert.equal(embed.image.url, 'https://cdn/p.png');
});

// ── the reaction event ───────────────────────────────────────────────────────

function fakeReaction(guild, { count = 3, emoji = '⭐', channelId = 'general', messageId = 'msg-1', partial = false }) {
  const message = {
    id: messageId,
    partial: false,
    guild,
    channelId,
    content: 'stellar comment',
    url: 'https://discord.com/channels/1/2/3',
    author: { username: 'brand', displayAvatarURL: () => null },
    member: { displayName: 'Brand' },
    attachments: new Map(),
    client: { config: { homeGuildId: guild.id } },
  };
  const reaction = {
    partial,
    emoji: { name: emoji },
    count,
    message,
    fetch: async () => ({ ...reaction, partial: false }),
  };
  return reaction;
}

test('star-watch boards at the threshold, once, and ignores wrong emoji/low counts', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  setStarboardConfig(guildId, { channelId: 'board', threshold: 3 });

  await starWatch.execute(fakeReaction(guild, { count: 2 }), { bot: false });
  assert.equal(guild.sends.length, 0, 'below threshold');
  await starWatch.execute(fakeReaction(guild, { emoji: '👍', count: 5 }), { bot: false });
  assert.equal(guild.sends.length, 0, 'wrong emoji');
  await starWatch.execute(fakeReaction(guild, { count: 3 }), { bot: false });
  assert.equal(guild.sends.length, 1, 'boards at threshold');
  await starWatch.execute(fakeReaction(guild, { count: 4 }), { bot: false });
  assert.equal(guild.sends.length, 1, 'the 4th star does not re-board');
});

test('star-watch ignores bot reactors, foreign guilds, and the board channel itself', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  setStarboardConfig(guildId, { channelId: 'board', threshold: 1 });

  await starWatch.execute(fakeReaction(guild, { count: 5, messageId: 'bot-react' }), { bot: true });
  assert.equal(guild.sends.length, 0, 'bot reactors never count');

  const foreign = fakeReaction(guild, { count: 5, messageId: 'foreign' });
  foreign.message.client.config.homeGuildId = 'some-other-guild';
  await starWatch.execute(foreign, { bot: false });
  assert.equal(guild.sends.length, 0, 'foreign guild ignored');

  await starWatch.execute(fakeReaction(guild, { count: 5, channelId: 'board', messageId: 'on-board' }), { bot: false });
  assert.equal(guild.sends.length, 0, 'board channel never re-boards');
});

test('star-watch fetches partial reactions before judging them', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  setStarboardConfig(guildId, { channelId: 'board', threshold: 2 });
  const partial = fakeReaction(guild, { count: 2, messageId: 'old-msg', partial: true });
  await starWatch.execute(partial, { bot: false });
  assert.equal(guild.sends.length, 1, 'partial was fetched and boarded');
});
