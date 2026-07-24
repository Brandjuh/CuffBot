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
