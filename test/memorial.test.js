import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { decodeEntities, mergeSeen, parseFeed, unseenItems } from '../src/modules/memorial/lib/rss.js';
import {
  FEEDS,
  getSeen,
  memorialEmbed,
  setMemorialConfig,
  sweepMemorial,
} from '../src/modules/memorial/service.js';

const DATA_DIR = mkdtempSync(path.join(tmpdir(), 'cuffbot-memorial-'));
process.env.CUFFBOT_DATA_DIR = DATA_DIR;
after(() => {
  delete process.env.CUFFBOT_DATA_DIR;
  rmSync(DATA_DIR, { recursive: true, force: true });
});

let seq = 0;
const freshGuildId = () => `50000000000000${String((seq += 1)).padStart(4, '0')}`;

const RSS = (items) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Feed</title>
${items
  .map(
    (i) => `<item>
  <title>${i.title}</title>
  <link>${i.link ?? 'https://example.org/x'}</link>
  ${i.guid ? `<guid isPermaLink="false">${i.guid}</guid>` : ''}
  <pubDate>${i.date ?? 'Thu, 24 Jul 2026 12:00:00 +0000'}</pubDate>
</item>`,
  )
  .join('\n')}
</channel></rss>`;

// ── parsing ──────────────────────────────────────────────────────────────────

test('parseFeed extracts id/title/link/date in document order', () => {
  const xml = RSS([
    { title: 'Newest', guid: 'g1' },
    { title: 'Older', guid: 'g2' },
  ]);
  const items = parseFeed(xml);
  assert.equal(items.length, 2);
  assert.deepEqual(items.map((i) => i.title), ['Newest', 'Older']);
  assert.equal(items[0].id, 'g1');
  assert.match(items[0].pubDate, /Jul 2026/);
});

test('parseFeed unwraps CDATA, decodes entities, and falls back to link ids', () => {
  const xml = `<rss><channel>
    <item><title><![CDATA[Officer O&#39;Brien &amp; K-9 <Rex>]]></title><link>https://x.org/1</link></item>
    <item><title>Plain &amp; simple</title><link>https://x.org/2</link></item>
    <item><title>No id at all</title></item>
  </channel></rss>`;
  const items = parseFeed(xml);
  assert.equal(items.length, 2, 'the id-less item is dropped');
  assert.equal(items[0].title, "Officer O'Brien & K-9 <Rex>");
  assert.equal(items[0].id, 'https://x.org/1', 'link is the guid fallback');
  assert.equal(items[1].title, 'Plain & simple');
});

test('parseFeed yields [] on garbage instead of throwing', () => {
  assert.deepEqual(parseFeed('this is not xml'), []);
  assert.deepEqual(parseFeed(''), []);
  assert.deepEqual(parseFeed(null), []);
});

test('decodeEntities handles numeric and hex forms', () => {
  assert.equal(decodeEntities('&#72;&#x69;&excl;'), 'Hi&excl;');
});

test('unseenItems returns oldest-first, caps the batch, and mergeSeen bounds the store', () => {
  const items = parseFeed(RSS([{ title: 'c', guid: '3' }, { title: 'b', guid: '2' }, { title: 'a', guid: '1' }]));
  const fresh = unseenItems(items, ['1'], 5);
  assert.deepEqual(fresh.map((i) => i.id), ['2', '3'], 'oldest of the new first');
  assert.deepEqual(unseenItems(items, ['1', '2', '3']), []);
  const capped = unseenItems(items, [], 2);
  assert.equal(capped.length, 2);
  const seen = mergeSeen(Array.from({ length: 199 }, (_, i) => `old${i}`), ['newA', 'newB']);
  assert.equal(seen.length, 200);
  assert.equal(seen[seen.length - 1], 'newB');
  assert.equal(seen[0], 'old1', 'oldest entries age out');
});

// ── sweep behavior ───────────────────────────────────────────────────────────

function fakeGuild(guildId) {
  const sends = [];
  const channel = { id: 'mem-chan', send: async (p) => (sends.push(p), p) };
  return { id: guildId, channels: { cache: new Map([['mem-chan', channel]]) }, sends };
}

const fetchFor = (byUrl) => async (url) => ({
  ok: true,
  status: 200,
  text: async () => byUrl[url] ?? RSS([]),
});

test('first sweep BASELINES both feeds without posting; later sweeps post only new items', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  // odmpChannelId now defaults to the owner's real channel (S61) — point it at
  // the fake channel; firehero items need filter-passing profile links (S61).
  setMemorialConfig(guildId, { channelId: 'mem-chan', odmpChannelId: 'mem-chan' });
  const heroLink = (slug) => `https://www.firehero.org/fallen-firefighter/${slug}/`;

  const initial = {
    [FEEDS[0].url]: RSS([{ title: 'History A', guid: 'fa1', link: heroLink('a') }]),
    [FEEDS[1].url]: RSS([{ title: 'History B', guid: 'ob1' }]),
  };
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(initial) }), 0, 'baseline posts nothing');
  assert.equal(guild.sends.length, 0);
  assert.deepEqual(getSeen(guildId)[FEEDS[0].id], ['fa1']);

  const updated = {
    [FEEDS[0].url]: RSS([
      { title: 'New Fallen Firefighter', guid: 'fa2', link: heroLink('b') },
      { title: 'History A', guid: 'fa1', link: heroLink('a') },
    ]),
    [FEEDS[1].url]: RSS([{ title: 'History B', guid: 'ob1' }]),
  };
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(updated) }), 1);
  assert.equal(guild.sends.length, 1);
  assert.equal(guild.sends[0].content, `<@&${FEEDS[0].roleId}>`, 'tags the firefighter role');
  assert.deepEqual(guild.sends[0].allowedMentions, { roles: [FEEDS[0].roleId] });
  assert.match(guild.sends[0].embeds[0].toJSON().title, /New Fallen Firefighter/);

  // Same content again → nothing reposts.
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(updated) }), 0);
  assert.equal(guild.sends.length, 1);
});

test('sweep is a no-op when disabled/unconfigured and survives unreachable feeds', async () => {
  const guildId = freshGuildId();
  const guild = fakeGuild(guildId);
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor({}) }), 0, 'no channel configured');

  setMemorialConfig(guildId, { channelId: 'mem-chan', enabled: false });
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor({}) }), 0, 'disabled');

  setMemorialConfig(guildId, { enabled: true });
  const dead = async () => {
    throw new Error('ENOTFOUND');
  };
  assert.equal(await sweepMemorial(guild, { fetchImpl: dead }), 0, 'unreachable feeds never throw');
});

test('a failing channel send retries the item on the next sweep', async () => {
  const guildId = freshGuildId();
  const sends = [];
  let broken = true;
  const channel = {
    id: 'mem-chan',
    send: async (p) => {
      if (broken) throw new Error('missing permissions');
      sends.push(p);
      return p;
    },
  };
  const guild = { id: guildId, channels: { cache: new Map([['mem-chan', channel]]) } };
  setMemorialConfig(guildId, { channelId: 'mem-chan', odmpChannelId: 'mem-chan' });
  const hero = (slug) => `https://www.firehero.org/fallen-firefighter/${slug}/`;

  const feeds = { [FEEDS[0].url]: RSS([{ title: 'Base', guid: 'b1', link: hero('base') }]), [FEEDS[1].url]: RSS([]) };
  await sweepMemorial(guild, { fetchImpl: fetchFor(feeds) }); // baseline
  const withNew = {
    ...feeds,
    [FEEDS[0].url]: RSS([{ title: 'New', guid: 'b2', link: hero('new') }, { title: 'Base', guid: 'b1', link: hero('base') }]),
  };

  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(withNew) }), 0, 'send failed');
  assert.equal(getSeen(guildId)[FEEDS[0].id].includes('b2'), false, 'failed post stays unseen');

  broken = false;
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(withNew) }), 1, 'retried and delivered');
  assert.equal(getSeen(guildId)[FEEDS[0].id].includes('b2'), true);
});

test('memorialEmbed renders title, link, and date', () => {
  const embed = memorialEmbed(FEEDS[1], { title: 'Officer Test', link: 'https://odmp.org/x', pubDate: 'Thu, 24 Jul 2026' }).toJSON();
  assert.match(embed.title, /Officer Test/);
  assert.equal(embed.url, 'https://odmp.org/x');
  assert.match(embed.description, /not forgotten/);
  assert.match(embed.description, /24 Jul 2026/);
});

// ── per-feed channels (S60) ──────────────────────────────────────────────────

test('per-feed channel defaults are null and the fallback rule holds (S60)', async () => {
  const { DEFAULT_MEMORIAL_CONFIG, channelIdForFeed } = await import('../src/modules/memorial/service.js');
  assert.equal(DEFAULT_MEMORIAL_CONFIG.odmpChannelId, '451095508560379934', 'owner-set since S61');
  assert.equal(DEFAULT_MEMORIAL_CONFIG.fireheroChannelId, null);
  assert.equal(channelIdForFeed({ channelId: 'shared' }, 'odmp'), 'shared', 'shared fallback');
  assert.equal(
    channelIdForFeed({ channelId: 'shared', odmpChannelId: 'own' }, 'odmp'),
    'own',
    'a feed’s own channel wins',
  );
  assert.equal(channelIdForFeed({}, 'firehero'), null);
});

function twoChannelGuild(guildId) {
  const officers = { id: 'officers-chan', sends: [], send: async (p) => (officers.sends.push(p), p) };
  const firefighters = { id: 'fire-chan', sends: [], send: async (p) => (firefighters.sends.push(p), p) };
  return {
    id: guildId,
    channels: {
      cache: new Map([
        ['officers-chan', officers],
        ['fire-chan', firefighters],
      ]),
    },
    officers,
    firefighters,
  };
}

test('each feed posts to its OWN channel (S60 owner request)', async () => {
  const guildId = freshGuildId();
  const guild = twoChannelGuild(guildId);
  setMemorialConfig(guildId, { odmpChannelId: 'officers-chan', fireheroChannelId: 'fire-chan' });

  const fire = (slug) => `https://www.firehero.org/fallen-firefighter/${slug}/`;
  const base = {
    [FEEDS[0].url]: RSS([{ title: 'Fire base', guid: 'fb1', link: fire('base') }]),
    [FEEDS[1].url]: RSS([{ title: 'Officer base', guid: 'ob1' }]),
  };
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(base) }), 0, 'baseline, no shared channel needed');

  const withNew = {
    [FEEDS[0].url]: RSS([
      { title: 'New Firefighter Entry', guid: 'fb2', link: fire('new') },
      { title: 'Fire base', guid: 'fb1', link: fire('base') },
    ]),
    [FEEDS[1].url]: RSS([{ title: 'New Officer Entry', guid: 'ob2' }, { title: 'Officer base', guid: 'ob1' }]),
  };
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(withNew) }), 2);
  assert.equal(guild.firefighters.sends.length, 1);
  assert.match(guild.firefighters.sends[0].embeds[0].toJSON().title, /New Firefighter Entry/);
  assert.equal(guild.officers.sends.length, 1);
  assert.match(guild.officers.sends[0].embeds[0].toJSON().title, /New Officer Entry/);
});

test('a feed without any channel is skipped while the other still posts (S60)', async () => {
  const guildId = freshGuildId();
  const guild = twoChannelGuild(guildId);
  setMemorialConfig(guildId, { odmpChannelId: 'officers-chan' }); // firefighters: nothing

  const base = {
    [FEEDS[0].url]: RSS([{ title: 'Fire base', guid: 'fx1' }]),
    [FEEDS[1].url]: RSS([{ title: 'Officer base', guid: 'ox1' }]),
  };
  await sweepMemorial(guild, { fetchImpl: fetchFor(base) });
  const withNew = {
    [FEEDS[0].url]: RSS([{ title: 'Fire new', guid: 'fx2' }, { title: 'Fire base', guid: 'fx1' }]),
    [FEEDS[1].url]: RSS([{ title: 'Officer new', guid: 'ox2' }, { title: 'Officer base', guid: 'ox1' }]),
  };
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(withNew) }), 1, 'only the configured feed posts');
  assert.equal(guild.officers.sends.length, 1);
  assert.equal(guild.firefighters.sends.length, 0);
  const { getSeen: seenOf } = await import('../src/modules/memorial/service.js');
  assert.ok(!Array.isArray(seenOf(guildId).firehero), 'unconfigured feed is not even baselined');
});

// ── S61: owner officers config, item filter, probe ───────────────────────────

test('S61 owner decisions are committed: officers channel + corrected ping role, firehero filter', async () => {
  const { DEFAULT_MEMORIAL_CONFIG } = await import('../src/modules/memorial/service.js');
  assert.equal(DEFAULT_MEMORIAL_CONFIG.odmpChannelId, '451095508560379934', 'officers channel (owner, S61)');
  const odmp = FEEDS.find((f) => f.id === 'odmp');
  assert.equal(odmp.roleId, '627946543273738240', 'S21 role id was actually the channel — corrected');
  const firehero = FEEDS.find((f) => f.id === 'firehero');
  assert.deepEqual(firehero.match, { linkIncludes: ['/fallen-firefighter'] });
});

test('itemMatchesFeed: no rules pass all; link/title needles; misses filtered', async () => {
  const { itemMatchesFeed } = await import('../src/modules/memorial/lib/rss.js');
  assert.equal(itemMatchesFeed(undefined, { link: 'https://x/news' }), true);
  const match = { linkIncludes: ['/fallen-firefighter'] };
  assert.equal(itemMatchesFeed(match, { link: 'https://www.firehero.org/fallen-firefighter/john-doe/' }), true);
  assert.equal(itemMatchesFeed(match, { link: 'https://www.firehero.org/2026/gala-announced/' }), false);
  assert.equal(itemMatchesFeed({ titleIncludes: ['line of duty'] }, { title: 'Line of Duty Death: J. Doe' }), true);
  assert.equal(itemMatchesFeed({ titleIncludes: ['line of duty'] }, { title: 'Annual Gala' }), false);
});

test('a filtered feed posts profiles only — news never lands (S61)', async () => {
  const guildId = freshGuildId();
  const guild = twoChannelGuild(guildId);
  setMemorialConfig(guildId, { odmpChannelId: 'officers-chan', fireheroChannelId: 'fire-chan' });

  const profile = (guid, name) => ({ title: name, guid, link: `https://www.firehero.org/fallen-firefighter/${guid}/` });
  const news = (guid, title) => ({ title, guid, link: `https://www.firehero.org/2026/${guid}/` });

  // First fetch: only news → baseline happens anyway (0 matching items).
  const allNews = { [FEEDS[0].url]: RSS([news('n1', 'Gala announced')]), [FEEDS[1].url]: RSS([]) };
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(allNews) }), 0);
  const { getSeen: seenOf } = await import('../src/modules/memorial/service.js');
  assert.ok(Array.isArray(seenOf(guildId).firehero), 'baselined on first successful fetch, even all-news');

  // A hero profile appears among fresh news → ONLY the profile posts.
  const withProfile = {
    [FEEDS[0].url]: RSS([profile('hero1', 'Firefighter John Doe'), news('n2', 'New merch'), news('n1', 'Gala announced')]),
    [FEEDS[1].url]: RSS([]),
  };
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(withProfile) }), 1);
  assert.equal(guild.firefighters.sends.length, 1);
  assert.match(guild.firefighters.sends[0].embeds[0].toJSON().title, /John Doe/);

  // More news only → silence.
  const moreNews = {
    [FEEDS[0].url]: RSS([news('n3', 'Sponsor day'), profile('hero1', 'Firefighter John Doe')]),
    [FEEDS[1].url]: RSS([]),
  };
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(moreNews) }), 0);
});

test('an unreachable feed does NOT baseline (null ≠ empty, S61)', async () => {
  const guildId = freshGuildId();
  const guild = twoChannelGuild(guildId);
  setMemorialConfig(guildId, { fireheroChannelId: 'fire-chan' });
  const dead = async () => ({ ok: false, status: 503, text: async () => '' });
  assert.equal(await sweepMemorial(guild, { fetchImpl: dead }), 0);
  const { getSeen: seenOf } = await import('../src/modules/memorial/service.js');
  assert.ok(!Array.isArray(seenOf(guildId).firehero), 'no baseline on failure');
});

test('probeFeed reports totals, samples, and honest failures (S61)', async () => {
  const { probeFeed } = await import('../src/modules/memorial/service.js');
  const xml = RSS([
    { title: 'Notice One', guid: 'p1', link: 'https://apps.usfa.fema.gov/ff/1' },
    { title: 'Notice Two', guid: 'p2' },
    { title: 'Notice Three', guid: 'p3' },
    { title: 'Notice Four', guid: 'p4' },
  ]);
  const ok = await probeFeed('https://apps.usfa.fema.gov/ff/rss.xml', {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => xml }),
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.total, 4);
  assert.equal(ok.sample.length, 3);
  assert.equal(ok.sample[0].title, 'Notice One');

  assert.deepEqual(await probeFeed('not a url', {}), { ok: false, code: 'bad-url' });
  const http = await probeFeed('https://x.example/feed', {
    fetchImpl: async () => ({ ok: false, status: 404, text: async () => '' }),
  });
  assert.deepEqual(http, { ok: false, code: 'http', status: 404 });
  const dead = await probeFeed('https://x.example/feed', {
    fetchImpl: async () => {
      throw new Error('boom');
    },
  });
  assert.equal(dead.code, 'unreachable');
});
