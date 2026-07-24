// Pure channel-list logic — no discord.js. Ported from the owner's FRA bot
// cog (FireAndRescueAcademyCogs → channellist; S36 owner request: "the same
// channel list as the FRA bot"): render the server's categories and channels
// into embed-sized text chunks, and decide whether a fresh render needs an
// edit, a repost, or nothing at all.

export const CHUNK_CHAR_LIMIT = 4_000; // stays under Discord's 4096 embed-description cap
export const AUTO_UPDATE_DELAY_MS = 10_000; // debounce: a burst of channel edits → one refresh
export const MAX_HEADER_LENGTH = 1_500;
export const DEFAULT_HEADER = 'All public channels and their description are listed below.';
export const DEFAULT_EMBED_COLOR = 0x5865f2;
export const EMPTY_LIST_PLACEHOLDER = '*There are no channels to display.*';

export const ACTION_SKIP = 'skip';
export const ACTION_EDIT = 'edit';
export const ACTION_REPOST = 'repost';

/** Collapse a channel topic to a single line of text. */
export function normalizeTopic(topic) {
  if (!topic) return '';
  return String(topic).split(/\s+/).filter(Boolean).join(' ');
}

/** One list line: `#mention - topic`, or just the mention when there is no topic. */
export function formatChannelLine(mention, topic) {
  const clean = normalizeTopic(topic);
  return clean ? `${mention} - ${clean}` : mention;
}

/** Category header line, optionally decorated with an emoji on both sides. */
export function formatCategoryHeader(name, emoji) {
  return emoji ? `**[${emoji}] [${name}] [${emoji}]**` : `**[${name}]**`;
}

/**
 * Group plain channel descriptors the way the Discord UI shows them:
 * channels above the first category come first (no header), then each
 * category by position; inside a group text-like channels (by position)
 * sit above voice-like ones.
 *
 * Descriptor: `{ id, kind: 'text'|'voice'|'category', name, parentId,
 * position, topic, visible, mention }`. An ignored category hides all its
 * channels; a channel whose parent no longer exists falls back to the top
 * block (mirroring how Discord renders orphans).
 *
 * @returns {Array<{name: string|null, entries: Array<{mention, topic}>}>}
 */
export function groupByCategory(descriptors, { includeVoice = true, ignoredIds = [] } = {}) {
  const ignored = new Set(ignoredIds.map(String));
  const categories = descriptors
    .filter((d) => d.kind === 'category' && !ignored.has(String(d.id)))
    .sort((a, b) => a.position - b.position);
  const groups = new Map([[null, []]]);
  for (const category of categories) groups.set(category.id, []);

  for (const descriptor of descriptors) {
    if (descriptor.kind === 'category') continue;
    if (ignored.has(String(descriptor.id))) continue;
    if (!includeVoice && descriptor.kind === 'voice') continue;
    if (!descriptor.visible) continue;
    const parent = descriptor.parentId ?? null;
    if (parent === null) {
      groups.get(null).push(descriptor);
    } else if (groups.has(parent)) {
      groups.get(parent).push(descriptor);
    } else if (!ignored.has(String(parent))) {
      groups.get(null).push(descriptor); // orphan: parent unknown, show on top
    }
  }

  const sortGroup = (list) =>
    list
      .slice()
      .sort((a, b) => (a.kind === b.kind ? a.position - b.position : a.kind === 'voice' ? 1 : -1));
  const toEntries = (list) => sortGroup(list).map((d) => ({ mention: d.mention, topic: d.topic }));

  const result = [];
  if (groups.get(null).length) result.push({ name: null, entries: toEntries(groups.get(null)) });
  for (const category of categories) {
    const entries = groups.get(category.id);
    if (entries.length) result.push({ name: category.name, entries: toEntries(entries) });
  }
  return result;
}

/**
 * Turn grouped categories into blocks of message lines. A `null` category
 * name gets no header (channels above the first category).
 */
export function renderBlocks(categories, emoji) {
  const blocks = [];
  for (const { name, entries } of categories) {
    if (!entries?.length) continue;
    const lines = [];
    if (name !== null && name !== undefined) lines.push(formatCategoryHeader(name, emoji));
    for (const { mention, topic } of entries) lines.push(formatChannelLine(mention, topic));
    blocks.push(lines);
  }
  return blocks;
}

/**
 * Pack the header and blocks into embed-sized chunks. Blocks are separated by
 * a blank line, and a block's first line is kept together with the line after
 * it — a category header is never stranded at the bottom of one message while
 * its channels start in the next.
 */
export function chunkBlocks(header, blocks, limit = CHUNK_CHAR_LIMIT) {
  const chunks = [];
  let current = String(header ?? '').trim().slice(0, limit);
  for (const block of blocks) {
    const lines = block.filter(Boolean).map((line) => line.slice(0, limit));
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      let separator;
      if (index === 0) {
        const needed = lines.slice(0, 2).join('\n').length;
        if (current && current.length + 2 + needed > limit) {
          chunks.push(current);
          current = '';
        }
        separator = current ? '\n\n' : '';
      } else {
        separator = current ? '\n' : '';
      }
      const candidate = `${current}${separator}${line}`;
      if (current && candidate.length > limit) {
        chunks.push(current);
        current = line;
      } else {
        current = candidate;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Choose how a freshly rendered list should be applied. `existingContents`
 * must be null when nothing usable is posted (no stored messages, or at least
 * one of them is gone) — that always forces a repost. Editing is only
 * possible when every stored message still exists and the new list does not
 * need more messages than are posted.
 */
export function decideAction(newChunks, existingContents) {
  if (!existingContents || existingContents.length === 0) return ACTION_REPOST;
  if (newChunks.length > existingContents.length) return ACTION_REPOST;
  if (
    newChunks.length === existingContents.length &&
    newChunks.every((chunk, index) => chunk === existingContents[index])
  ) {
    return ACTION_SKIP;
  }
  return ACTION_EDIT;
}

/** Parse `#5865f2`-style hex input to an integer color, or null when invalid. */
export function parseHexColor(input) {
  const cleaned = String(input ?? '').trim().replace(/^#/, '');
  if (!/^[0-9a-f]{1,6}$/i.test(cleaned)) return null;
  return Number.parseInt(cleaned, 16);
}

/** Normalize the emoji option: `none`/`off`/empty removes it. */
export function normalizeEmojiInput(input) {
  const value = String(input ?? '').trim();
  if (!value || ['none', 'off'].includes(value.toLowerCase())) return '';
  return value.slice(0, 80);
}
