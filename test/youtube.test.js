import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  formatAnnouncement,
  parseCreatorInput,
  parseYouTubeFeed,
  pickNewVideos,
  rememberSeen,
} from '../src/modules/youtube/lib/feed.js';
import {
  DEFAULT_YOUTUBE_CONFIG,
  addCreator,
  getCreators,
  removeCreator,
  resolveChannelId,
  setYouTubeConfig,
  sweepYouTube,
} from '../src/modules/youtube/service.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-youtube-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `60000000000000${String((seq += 1)).padStart(4, '0')}`;

const UC = 'UCabcdefghijklmnopqrstuv';

const feedXml = (videos, channelTitle = 'Creator &amp; Co') => `<?xml version="1.0"?>
<feed xmlns:yt="http://www.youtube.com/xml/schemas/2015" xmlns="http://www.w3.org/2005/Atom">
 <title>${channelTitle}</title>
 ${videos
   .map(
     (v) => `<entry>
  <id>yt:video:${v.id}</id>
  <yt:videoId>${v.id}</yt:videoId>
  <title>${v.title}</title>
  <link rel="alternate" href="https://www.youtube.com/watch?v=${v.id}"/>
  <published>${v.published}</published>
 </entry>`,
   )
   .join('\n')}
</feed>`;

// ── pure feed logic ──────────────────────────────────────────────────────────

test('parseYouTubeFeed reads entries, decodes entities, survives garbage', () => {
  const xml = feedXml([
    { id: 'vid00000002', title: 'Second &amp; newest', published: '2026-07-24T12:00:00+00:00' },
    { id: 'vid00000001', title: '<![CDATA[First one]]>', published: '2026-07-24T10:00:00+00:00' },
  ]);
  const feed = parseYouTubeFeed(xml);
  assert.equal(feed.channelTitle, 'Creator & Co');
  assert.equal(feed.videos.length, 2);
  assert.equal(feed.videos[0].title, 'Second & newest');
  assert.equal(feed.videos[1].title, 'First one');
  assert.equal(feed.videos[0].url, 'https://www.youtube.com/watch?v=vid00000002');
  assert.ok(feed.videos[0].publishedAt > feed.videos[1].publishedAt);

  assert.deepEqual(parseYouTubeFeed('<html>not a feed</html>').videos, []);
  assert.deepEqual(parseYouTubeFeed(null).videos, []);
});

test('parseCreatorInput handles ids, URLs, and handles', () => {
  assert.deepEqual(parseCreatorInput(UC), { channelId: UC });
  assert.deepEqual(parseCreatorInput(`https://www.youtube.com/channel/${UC}`), { channelId: UC });
  assert.deepEqual(parseCreatorInput(`https://www.youtube.com/feeds/videos.xml?channel_id=${UC}`), {
    channelId: UC,
  });
  assert.deepEqual(parseCreatorInput('@SomeCreator'), { handle: 'SomeCreator' });
  assert.deepEqual(parseCreatorInput('https://youtube.com/@Some.Creator'), { handle: 'Some.Creator' });
  assert.equal(parseCreatorInput('https://www.youtube.com/watch?v=abc'), null);
  assert.equal(parseCreatorInput(''), null);
});

test('pickNewVideos: unseen only, oldest first, capped', () => {
  const videos = [
    { videoId: 'c', publishedAt: 3 },
    { videoId: 'b', publishedAt: 2 },
    { videoId: 'a', publishedAt: 1 },
    { videoId: 'seen', publishedAt: 0 },
  ];
  const fresh = pickNewVideos(videos, ['seen'], { cap: 2 });
  assert.deepEqual(fresh.map((v) => v.videoId), ['a', 'b'], 'oldest first, cap respected');
});

test('rememberSeen rings at the cap and dedupes', () => {
  const seen = rememberSeen(['a', 'b'], ['b', 'c'], { cap: 3 });
  assert.deepEqual(seen, ['a', 'b', 'c']);
  assert.deepEqual(rememberSeen(['a', 'b', 'c'], ['d'], { cap: 3 }), ['b', 'c', 'd']);
});

test('formatAnnouncement carries the plain link so Discord embeds the player', () => {
  const line = formatAnnouncement('Creator', { title: 'New vid', url: 'https://www.youtube.com/watch?v=x' });
  assert.match(line, /\*\*Creator\*\* just uploaded/);
  assert.match(line, /\nhttps:\/\/www\.youtube\.com\/watch\?v=x$/);
  const pinged = formatAnnouncement('Creator', { title: 'V', url: 'u' }, { pingRoleId: '625326875442675763' });
  assert.match(pinged, /^<@&625326875442675763> 📺/, 'the ping role leads the message (S53)');
});

test('the owner ping role is the committed default (S53)', () => {
  assert.equal(DEFAULT_YOUTUBE_CONFIG.pingRoleId, '625326875442675763');
});

// ── service with fake fetch ──────────────────────────────────────────────────

const okResponse = (body) => ({ ok: true, status: 200, text: async () => body });

test('resolveChannelId resolves @handles via one page fetch', async () => {
  const fetchImpl = async (url) => {
    assert.match(url, /youtube\.com\/@somecreator/i);
    return okResponse(`<html>… "channelId":"${UC}" …</html>`);
  };
  assert.equal(await resolveChannelId('@SomeCreator', { fetchImpl }), UC);
  assert.equal(await resolveChannelId('@ghost', { fetchImpl: async () => okResponse('<html>no id</html>') }), null);
  assert.equal(await resolveChannelId('junk-input', { fetchImpl: async () => okResponse('') }), null);
});

test('addCreator validates the feed, learns the name, and baselines the back catalog', async () => {
  const guildId = freshGuildId();
  const xml = feedXml([
    { id: 'old00000002', title: 'Old two', published: '2026-07-20T10:00:00+00:00' },
    { id: 'old00000001', title: 'Old one', published: '2026-07-19T10:00:00+00:00' },
  ]);
  const result = await addCreator(guildId, UC, { fetchImpl: async () => okResponse(xml) });
  assert.equal(result.ok, true);
  assert.equal(result.name, 'Creator & Co');
  assert.equal(result.latest, 'Old two');
  const stored = getCreators(guildId)[UC];
  assert.deepEqual(stored.seenVideoIds.sort(), ['old00000001', 'old00000002'], 'back catalog baselined');

  const dupe = await addCreator(guildId, UC, { fetchImpl: async () => okResponse(xml) });
  assert.equal(dupe.code, 'exists');
  const broken = await addCreator(guildId, 'UCzzzzzzzzzzzzzzzzzzzzzz', {
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }),
  });
  assert.equal(broken.code, 'fetch-failed');
});

function fakeAnnounceGuild(guildId, { failSends = 0 } = {}) {
  const sends = [];
  const state = { failLeft: failSends };
  const channel = {
    id: 'yt-chan',
    send: async (payload) => {
      if (state.failLeft > 0) {
        state.failLeft -= 1;
        throw new Error('send failed');
      }
      sends.push(payload);
      return payload;
    },
  };
  return { id: guildId, channels: { cache: new Map([['yt-chan', channel]]) }, sends };
}

test('sweep announces only NEW uploads, retries after a failed send, never pings', async () => {
  const guildId = freshGuildId();
  const guild = fakeAnnounceGuild(guildId);
  setYouTubeConfig(guildId, { channelId: 'yt-chan' });
  const backCatalog = feedXml([{ id: 'old00000001', title: 'Old', published: '2026-07-19T10:00:00+00:00' }]);
  await addCreator(guildId, UC, { fetchImpl: async () => okResponse(backCatalog) });

  // Same feed again → nothing new.
  assert.deepEqual(await sweepYouTube(guild, { fetchImpl: async () => okResponse(backCatalog) }), {
    posted: 0,
    checked: 1,
  });

  // A new upload appears.
  const withNew = feedXml([
    { id: 'new00000001', title: 'Fresh upload', published: '2026-07-24T10:00:00+00:00' },
    { id: 'old00000001', title: 'Old', published: '2026-07-19T10:00:00+00:00' },
  ]);
  const first = await sweepYouTube(guild, { fetchImpl: async () => okResponse(withNew), log: false });
  assert.equal(first.posted, 1);
  assert.match(guild.sends[0].content, /Fresh upload/);
  assert.match(guild.sends[0].content, /watch\?v=new00000001/);
  assert.match(guild.sends[0].content, /^<@&625326875442675763> /, 'the owner role is pinged (S53)');
  assert.deepEqual(
    guild.sends[0].allowedMentions,
    { roles: ['625326875442675763'] },
    'the ping is scoped to exactly that role',
  );

  // Already seen → silent.
  assert.equal((await sweepYouTube(guild, { fetchImpl: async () => okResponse(withNew) })).posted, 0);

  // A failed send leaves the video unseen → next sweep retries it.
  const withNewer = feedXml([
    { id: 'new00000002', title: 'Even fresher', published: '2026-07-24T12:00:00+00:00' },
    { id: 'new00000001', title: 'Fresh upload', published: '2026-07-24T10:00:00+00:00' },
  ]);
  const failing = fakeAnnounceGuild(guildId, { failSends: 1 });
  assert.equal((await sweepYouTube(failing, { fetchImpl: async () => okResponse(withNewer), log: false })).posted, 0);
  const retry = await sweepYouTube(failing, { fetchImpl: async () => okResponse(withNewer), log: false });
  assert.equal(retry.posted, 1);
  assert.match(failing.sends[0].content, /Even fresher/);

  // no-ping (pingRoleId null) restores the silent announcement.
  setYouTubeConfig(guildId, { pingRoleId: null });
  const withNewest = feedXml([
    { id: 'new00000003', title: 'Third', published: '2026-07-24T14:00:00+00:00' },
    { id: 'new00000002', title: 'Even fresher', published: '2026-07-24T12:00:00+00:00' },
  ]);
  const silent = fakeAnnounceGuild(guildId);
  await sweepYouTube(silent, { fetchImpl: async () => okResponse(withNewest), log: false });
  assert.ok(!silent.sends[0].content.startsWith('<@&'), 'no role mention when cleared');
  assert.deepEqual(silent.sends[0].allowedMentions, { parse: [] });
  setYouTubeConfig(guildId, { pingRoleId: '625326875442675763' });
});

test('sweep still posts when the channel is missing from the cache but fetchable (S55)', async () => {
  const guildId = freshGuildId();
  setYouTubeConfig(guildId, { channelId: 'news-chan' });
  const backCatalog = feedXml([{ id: 'old00000009', title: 'Old', published: '2026-07-19T10:00:00+00:00' }]);
  await addCreator(guildId, UC, { fetchImpl: async () => okResponse(backCatalog) });

  const sends = [];
  const newsChannel = { id: 'news-chan', send: async (p) => (sends.push(p), p) };
  const guild = {
    id: guildId,
    channels: { cache: new Map(), fetch: async (id) => (id === 'news-chan' ? newsChannel : null) },
  };
  const withNew = feedXml([
    { id: 'new00000009', title: 'Announcement-channel upload', published: '2026-07-24T10:00:00+00:00' },
    { id: 'old00000009', title: 'Old', published: '2026-07-19T10:00:00+00:00' },
  ]);
  const result = await sweepYouTube(guild, { fetchImpl: async () => okResponse(withNew), log: false });
  assert.equal(result.posted, 1, 'cache miss resolved via the API, not a silent no-op');
  assert.match(sends[0].content, /Announcement-channel upload/);
});

test('sweep is a no-op when disabled, unconfigured, or the roster is empty', async () => {
  const emptyGuildId = freshGuildId();
  const guild = fakeAnnounceGuild(emptyGuildId);
  assert.deepEqual(await sweepYouTube(guild, { fetchImpl: async () => okResponse('') }), {
    posted: 0,
    checked: 0,
  });
  setYouTubeConfig(emptyGuildId, { channelId: 'yt-chan', enabled: false });
  assert.equal((await sweepYouTube(guild, { fetchImpl: async () => okResponse('') })).checked, 0);
});

test('removeCreator works by id and by name', async () => {
  const guildId = freshGuildId();
  await addCreator(guildId, UC, {
    fetchImpl: async () => okResponse(feedXml([], 'The Precinct Channel')),
  });
  assert.equal(removeCreator(guildId, 'the precinct channel'), 'The Precinct Channel');
  assert.equal(removeCreator(guildId, UC), null, 'already gone');
  assert.deepEqual(getCreators(guildId), {});
});

// ── the !youtube group command (S69 reference conversion) ────────────────────

const { default: youtubeCommand } = await import('../src/modules/youtube/commands/youtube.js');
const { getYouTubeConfig } = await import('../src/modules/youtube/service.js');
const group = youtubeCommand.group;
const sub = (name) => group.subcommands.find((s) => s.name === name);

function fakeCtx(guildId, { channels = {} } = {}) {
  const replies = [];
  return {
    replies,
    prefix: '!',
    guild: {
      id: guildId,
      channels: { cache: new Map(Object.entries(channels)), fetch: async (id) => channels[id] ?? null },
    },
    channel: { sendTyping: async () => {} },
    reply: async (p) => replies.push(typeof p === 'string' ? { content: p } : p),
  };
}

test('!youtube is a Manage-Server group with the full subcommand roster', () => {
  assert.equal(group.name, 'youtube');
  assert.equal(group.permission, 32n, 'ManageGuild gates the whole group');
  assert.deepEqual(
    group.subcommands.map((s) => s.name),
    ['on', 'off', 'channel', 'add', 'remove', 'preview', 'pingrole', 'noping'],
  );
});

test('youtube on/off flip the master switch', async () => {
  const guildId = freshGuildId();
  const ctx = fakeCtx(guildId);
  await sub('off').run(ctx);
  assert.equal(getYouTubeConfig(guildId).enabled, false);
  assert.match(ctx.replies[0].content, /off/);
  await sub('on').run(ctx);
  assert.equal(getYouTubeConfig(guildId).enabled, true);
});

test('youtube channel accepts text/announcement channels, refuses others', async () => {
  const guildId = freshGuildId();
  const ctx = fakeCtx(guildId);
  await sub('channel').run(ctx, { channel: { id: 'chan-9', type: 2 } }); // GuildVoice
  assert.match(ctx.replies[0].content, /text or announcement channel/);
  assert.equal(getYouTubeConfig(guildId).channelId, null, 'refused → unchanged');

  await sub('channel').run(ctx, { channel: { id: 'chan-9', type: 5 } }); // GuildAnnouncement
  assert.equal(getYouTubeConfig(guildId).channelId, 'chan-9');
});

test('youtube pingrole/noping set and clear the ping role', async () => {
  const guildId = freshGuildId();
  const ctx = fakeCtx(guildId);
  await sub('pingrole').run(ctx, { role: { id: '625326875442675763' } });
  assert.equal(getYouTubeConfig(guildId).pingRoleId, '625326875442675763');
  await sub('noping').run(ctx);
  assert.equal(getYouTubeConfig(guildId).pingRoleId, null);
});

test('youtube remove unfollows through the group sub', async () => {
  const guildId = freshGuildId();
  await addCreator(guildId, UC, {
    fetchImpl: async () => okResponse(feedXml([], 'Precinct TV')),
  });
  const ctx = fakeCtx(guildId);
  await sub('remove').run(ctx, { creator: 'precinct tv' });
  assert.match(ctx.replies[0].content, /Stopped following \*\*Precinct TV\*\*/);
  assert.deepEqual(getCreators(guildId), {});
});

test('youtube status reports enabled/channel/roster with the S55 probe', async () => {
  const guildId = freshGuildId();
  await addCreator(guildId, UC, {
    fetchImpl: async () => okResponse(feedXml([], 'Precinct TV')),
  });
  const sendable = { id: 'news-1', send: async () => {} };

  const unset = await group.status(fakeCtx(guildId));
  assert.match(unset[1], /not set — nothing posts/);

  await sub('channel').run(fakeCtx(guildId, { channels: { 'news-1': sendable } }), {
    channel: { id: 'news-1', type: 0 },
  });
  const lines = await group.status(fakeCtx(guildId, { channels: { 'news-1': sendable } }));
  assert.match(lines[0], /\*\*Enabled:\*\* yes/);
  assert.match(lines[1], /<#news-1>/);
  assert.match(lines.join('\n'), /Precinct TV/);

  const broken = await group.status(fakeCtx(guildId)); // channel gone from cache+API
  assert.match(broken[1], /can't post there/);
});
