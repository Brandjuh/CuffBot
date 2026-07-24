// Minimal, tolerant RSS parsing — pure text-in/objects-out, zero dependencies.
// We only need four fields per item (id, title, link, date), so this is a
// targeted extractor, not a full XML parser: it survives CDATA, entities,
// attribute-bearing tags, and unknown extra elements. Anything unparseable
// yields an empty list — the caller treats that as "nothing new", never a crash.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** Decode the handful of entities that actually occur in feed titles. */
export function decodeEntities(text) {
  return String(text ?? '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => ENTITIES[name.toLowerCase()] ?? m);
}

/** The text content of the FIRST <tag>…</tag> in a block, CDATA unwrapped. */
function firstTag(block, tag) {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(block);
  if (!match) return null;
  let value = match[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(value);
  if (cdata) value = cdata[1].trim();
  return decodeEntities(value).trim();
}

/**
 * Parse an RSS 2.0 (or close-enough) feed document.
 * @param {string} xml
 * @returns {Array<{id:string, title:string, link:string|null, pubDate:string|null}>}
 *   in document order (RSS convention: newest first). Items without a usable
 *   id (guid, or link as fallback) are dropped — we cannot dedupe them.
 */
export function parseFeed(xml) {
  const items = [];
  const blocks = String(xml ?? '').match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) ?? [];
  for (const block of blocks) {
    const guid = firstTag(block, 'guid');
    const link = firstTag(block, 'link');
    const id = guid || link;
    if (!id) continue;
    items.push({
      id,
      title: firstTag(block, 'title') ?? '(untitled)',
      link: link ?? null,
      pubDate: firstTag(block, 'pubDate'),
    });
  }
  return items;
}

/**
 * Which parsed items are new, given the ids we have already seen?
 * Returns them OLDEST FIRST (reverse document order) so the channel reads
 * chronologically, capped to avoid flooding — the rest stays unseen and posts
 * on the next sweep.
 */
export function unseenItems(items, seenIds, cap = 5) {
  const seen = new Set(seenIds ?? []);
  return items.filter((item) => !seen.has(item.id)).slice(0, cap).reverse();
}

/** Merge newly seen ids into the stored list, keeping only the newest `keep`. */
export function mergeSeen(previous, newIds, keep = 200) {
  const merged = [...(previous ?? []), ...newIds];
  return merged.slice(-keep);
}
