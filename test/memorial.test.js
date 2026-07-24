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
  setMemorialConfig(guildId, { channelId: 'mem-chan' });

  const initial = {
    [FEEDS[0].url]: RSS([{ title: 'History A', guid: 'fa1' }]),
    [FEEDS[1].url]: RSS([{ title: 'History B', guid: 'ob1' }]),
  };
  assert.equal(await sweepMemorial(guild, { fetchImpl: fetchFor(initial) }), 0, 'baseline posts nothing');
  assert.equal(guild.sends.length, 0);
  assert.deepEqual(getSeen(guildId)[FEEDS[0].id], ['fa1']);

  const updated = {
    [FEEDS[0].url]: RSS([{ title: 'New Fallen Firefighter', guid: 'fa2' }, { title: 'History A', guid: 'fa1' }]),
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
  setMemorialConfig(guildId, { channelId: 'mem-chan' });

  const feeds = { [FEEDS[0].url]: RSS([{ title: 'Base', guid: 'b1' }]), [FEEDS[1].url]: RSS([]) };
  await sweepMemorial(guild, { fetchImpl: fetchFor(feeds) }); // baseline
  const withNew = { ...feeds, [FEEDS[0].url]: RSS([{ title: 'New', guid: 'b2' }, { title: 'Base', guid: 'b1' }]) };

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
