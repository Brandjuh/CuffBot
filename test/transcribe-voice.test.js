// Live voice transcription (S102 = M21.2). Two halves, both pure: the Ogg
// container that carries Opus packets to Groq without ever decoding them, and
// the timing policy that decides what counts as a turn. Nothing here opens a
// voice connection — that plumbing lives in voice/session.js and is the one
// part a live test on the Pi has to cover.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SAMPLES_PER_FRAME,
  SAMPLE_RATE,
  buildPage,
  durationOf,
  encodeOggOpus,
  lacing,
  oggCrc32,
  opusHead,
  opusTags,
} from '../src/modules/transcribe/lib/ogg.js';
import {
  DEFAULT_VOICE_POLICY,
  cleanTranscript,
  createLineBuffer,
  formatLine,
  isOverCap,
  isWorthTranscribing,
  msToPackets,
  packLines,
  packetsToMs,
  shouldFlush,
} from '../src/modules/transcribe/lib/voice-session.js';
import transcribeCommand from '../src/modules/transcribe/commands/transcribe.js';
import {
  DEFAULT_VOICE_PAIRS,
  humansIn,
  normalizeChannelName,
  pairTextChannel,
  shouldAutoJoin,
  shouldAutoLeave,
} from '../src/modules/transcribe/lib/pairing.js';
import { DEFAULT_TRANSCRIBE_CONFIG } from '../src/modules/transcribe/lib/transcribe.js';
import { PermissionFlagsBits } from 'discord.js';

// ── an independent Ogg reader ────────────────────────────────────────────────

/**
 * Parse pages back out of an Ogg stream. Deliberately written as a READER, not
 * as a mirror of the writer: if both shared a helper they would agree with
 * each other while both being wrong. The byte offsets come from RFC 3533.
 *
 * (The writer was additionally cross-checked against `mutagen`, an unrelated
 * Ogg implementation, during S102 — its re-serialisation was byte-identical,
 * which is what proves the CRC variant is the Ogg one and not zlib's.)
 */
function readPages(buffer) {
  const pages = [];
  let at = 0;
  while (at < buffer.length) {
    assert.equal(buffer.toString('ascii', at, at + 4), 'OggS', `page ${pages.length} capture pattern`);
    const flags = buffer[at + 5];
    const granule = buffer.readBigUInt64LE(at + 6);
    const serial = buffer.readUInt32LE(at + 14);
    const sequence = buffer.readUInt32LE(at + 18);
    const crc = buffer.readUInt32LE(at + 22);
    const count = buffer[at + 26];
    const table = [...buffer.subarray(at + 27, at + 27 + count)];
    const bodyAt = at + 27 + count;
    const bodyLength = table.reduce((a, b) => a + b, 0);

    // Recompute the CRC the way a reader must: zero the field first.
    const page = Buffer.from(buffer.subarray(at, bodyAt + bodyLength));
    page.writeUInt32LE(0, 22);
    assert.equal(oggCrc32(page), crc, `page ${sequence} CRC`);

    // Reassemble packets from the lacing table: a value < 255 ends a packet.
    const packets = [];
    let start = bodyAt;
    let length = 0;
    for (const value of table) {
      length += value;
      if (value < 255) {
        packets.push(buffer.subarray(start, start + length));
        start += length;
        length = 0;
      }
    }
    pages.push({ flags, granule, serial, sequence, packets, continued: length > 0 });
    at = bodyAt + bodyLength;
  }
  return pages;
}

const frames = (count, size = 60) =>
  Array.from({ length: count }, (_, i) => Buffer.alloc(size, i % 256));

// ── the container ────────────────────────────────────────────────────────────

test('lacing follows the format, including the 255-multiple trap', () => {
  assert.deepEqual(lacing(0), [0]);
  assert.deepEqual(lacing(60), [60]);
  assert.deepEqual(lacing(254), [254]);
  // A packet of exactly 255 needs a TERMINATING zero — without it a reader
  // thinks the packet continues onto the next page.
  assert.deepEqual(lacing(255), [255, 0]);
  assert.deepEqual(lacing(256), [255, 1]);
  assert.deepEqual(lacing(600), [255, 255, 90]);
});

test('the Ogg CRC is Ogg’s variant, not zlib’s', () => {
  // Ogg: poly 0x04c11db7, init 0, no reflection, no final xor. If someone
  // "fixes" this to use zlib.crc32 every page becomes unreadable.
  assert.equal(oggCrc32(Buffer.alloc(0)), 0);
  assert.equal(oggCrc32(Buffer.from([0x00])), 0);
  assert.notEqual(oggCrc32(Buffer.from('OggS')), 0);
  // Deterministic and order-sensitive.
  assert.equal(oggCrc32(Buffer.from('abc')), oggCrc32(Buffer.from('abc')));
  assert.notEqual(oggCrc32(Buffer.from('abc')), oggCrc32(Buffer.from('cba')));
});

test('the identification and comment headers match RFC 7845', () => {
  const head = opusHead({ channels: 2 });
  assert.equal(head.length, 19);
  assert.equal(head.toString('ascii', 0, 8), 'OpusHead');
  assert.equal(head[8], 1, 'version 1');
  assert.equal(head[9], 2, 'channels');
  assert.equal(head.readUInt16LE(10), 3840, 'pre-skip');
  assert.equal(head.readUInt32LE(12), SAMPLE_RATE);
  assert.equal(head[18], 0, 'mapping family 0');

  const tags = opusTags('CuffBot');
  assert.equal(tags.toString('ascii', 0, 8), 'OpusTags');
  assert.equal(tags.readUInt32LE(8), 7, 'vendor length');
  assert.equal(tags.readUInt32LE(19), 0, 'no user comments');
});

test('a page refuses to hold more than the format allows', () => {
  // 256 one-byte packets = 256 lacing values, one over the limit. Silently
  // truncating here would produce a file that plays short.
  assert.throws(
    () => buildPage({ packets: frames(256, 1), granule: 0, serial: 1, sequence: 0 }),
    /256 segments/,
  );
});

test('an encoded capture round-trips through an independent reader', () => {
  const packets = frames(300, 60);
  packets[7] = Buffer.alloc(255, 1); // the lacing trap
  packets[9] = Buffer.alloc(600, 2); // spans three lacing values
  const pages = readPages(encodeOggOpus(packets));

  assert.equal(pages[0].flags & 0x02, 0x02, 'first page is beginning-of-stream');
  assert.equal(pages.at(-1).flags & 0x04, 0x04, 'last page is end-of-stream');
  assert.deepEqual(
    pages.map((p) => p.sequence),
    pages.map((_, i) => i),
    'page sequence is contiguous',
  );
  assert.equal(new Set(pages.map((p) => String(p.serial))).size, 1, 'one logical bitstream');

  const recovered = pages.flatMap((p) => p.packets);
  assert.equal(recovered[0].toString('ascii', 0, 8), 'OpusHead');
  assert.equal(recovered[1].toString('ascii', 0, 8), 'OpusTags');
  const audio = recovered.slice(2);
  assert.equal(audio.length, packets.length, 'every packet came back');
  assert.equal(audio[7].length, 255);
  assert.equal(audio[9].length, 600);
  for (const [i, packet] of audio.entries()) assert.deepEqual(packet, packets[i], `packet ${i}`);

  // Granule position is what tells a decoder how long the file is.
  assert.equal(pages.at(-1).granule, BigInt(packets.length * SAMPLES_PER_FRAME));
  assert.equal(durationOf(packets), 6, '300 × 20 ms = 6 s');
});

test('an empty capture is still a valid file, not a truncated stream', () => {
  const pages = readPages(encodeOggOpus([]));
  assert.equal(pages.length, 3, 'head, tags, and an empty end-of-stream page');
  assert.equal(pages.at(-1).flags & 0x04, 0x04);
  assert.equal(pages.at(-1).granule, 0n);
});

test('a packet too big for any page is refused rather than mangled', () => {
  assert.throws(() => encodeOggOpus([Buffer.alloc(255 * 256)]), /cannot fit one Ogg page/);
});

// ── the timing policy ────────────────────────────────────────────────────────

test('packet counts convert to milliseconds exactly — the packets ARE the clock', () => {
  assert.equal(packetsToMs(0), 0);
  assert.equal(packetsToMs(1), 20);
  assert.equal(packetsToMs(50), 1_000);
  assert.equal(msToPackets(1_000), 50);
  assert.equal(msToPackets(25), 2, 'rounds up — never claim less audio than we hold');
});

test('a monologue is cut, and a runaway stream is capped', () => {
  const { maxChunkMs, hardCapMs } = DEFAULT_VOICE_POLICY;
  assert.equal(shouldFlush(msToPackets(maxChunkMs) - 1), false);
  assert.equal(shouldFlush(msToPackets(maxChunkMs)), true);
  assert.equal(isOverCap(msToPackets(maxChunkMs)), false, 'flushing is not the cap');
  assert.equal(isOverCap(msToPackets(hardCapMs)), true);
  // A tighter policy is honoured, so the defaults are not baked in.
  assert.equal(shouldFlush(msToPackets(2_000), { maxChunkMs: 1_000 }), true);
});

test('a cough is not a turn', () => {
  assert.equal(isWorthTranscribing([]).reason, 'empty');
  // 700 ms is the floor: Discord opens a stream for a keyboard click, and
  // Whisper answers a second of room tone with a confident sentence.
  assert.equal(isWorthTranscribing(frames(10)).reason, 'too-short', '200 ms');
  const long = isWorthTranscribing(frames(100));
  assert.equal(long.ok, true);
  assert.equal(long.seconds, 2);
});

test('Whisper’s silence hallucinations never reach the channel', () => {
  // These are what it returns for room tone, every time, and they are
  // indistinguishable from real speech once they are in the log.
  for (const noise of ['Thank you.', 'thank you', 'You', 'Thanks for watching!', '.', '  ']) {
    assert.equal(cleanTranscript(noise), '', JSON.stringify(noise));
  }
  assert.equal(cleanTranscript('  Suspect fled north.  '), 'Suspect fled north.');
  assert.equal(cleanTranscript('Thank you for the update, officer.'), 'Thank you for the update, officer.', 'a real sentence that merely starts the same way survives');
});

test('a transcript line names the speaker and can be stamped', () => {
  const at = Date.parse('2026-07-26T14:32:09Z');
  assert.equal(formatLine({ name: 'Alice', text: 'Suspect fled north.', at }), '`14:32` **Alice:** Suspect fled north.');
  assert.equal(
    formatLine({ name: 'Alice', text: 'Suspect fled north.', at, timestamps: false }),
    '**Alice:** Suspect fled north.',
  );
  assert.equal(formatLine({ name: 'Alice', text: 'Thank you.', at }), null, 'silence produces no line at all');
});

test('lines are packed into posts, split only between lines', () => {
  const lines = Array.from({ length: 40 }, (_, i) => `line ${i} ${'x'.repeat(100)}`);
  const posts = packLines(lines, 500);
  assert.ok(posts.length > 1);
  for (const post of posts) assert.ok(post.length <= 500, `post is ${post.length}`);
  // Nothing is lost and nothing is reordered.
  assert.deepEqual(posts.join('\n').split('\n'), lines);
});

test('a single over-long line is split rather than dropped', () => {
  const posts = packLines([`${'y'.repeat(250)}`], 100);
  assert.equal(posts.length, 3);
  assert.equal(posts.join('').length, 250, 'every character survives');
});

test('the line buffer flushes on time OR on size, and never strands a line', () => {
  const buffer = createLineBuffer({ flushAfterMs: 5_000, softLimit: 100 });
  const t0 = 1_000_000;
  assert.equal(buffer.shouldFlush(t0), false, 'nothing buffered');

  buffer.add('short line', t0);
  assert.equal(buffer.shouldFlush(t0 + 4_999), false);
  assert.equal(buffer.shouldFlush(t0 + 5_000), true, 'a quiet channel must not strand it forever');

  const bySize = createLineBuffer({ flushAfterMs: 999_999, softLimit: 50 });
  bySize.add('x'.repeat(60), t0);
  assert.equal(bySize.shouldFlush(t0), true, 'a full buffer goes now, whatever the clock says');

  assert.deepEqual(bySize.drain(), ['x'.repeat(60)]);
  assert.equal(bySize.size, 0);
  assert.equal(bySize.shouldFlush(t0 + 10_000_000), false, 'draining resets the clock too');

  // formatLine returns null for silence; the buffer must not store that.
  const skipping = createLineBuffer();
  skipping.add(null, t0);
  assert.equal(skipping.size, 0);
});

// ── the command surface ──────────────────────────────────────────────────────

test('join and leave exist, are gated, and stop is an alias of leave', () => {
  const subs = transcribeCommand.group.subcommands;
  const join = subs.find((s) => s.name === 'join');
  const leave = subs.find((s) => s.name === 'leave');
  assert.ok(join && leave);
  // Recording what people say is not something any member may switch on.
  assert.equal(join.permission, PermissionFlagsBits.ManageGuild);
  assert.equal(leave.permission, PermissionFlagsBits.ManageGuild);
  assert.deepEqual(join.aliases, ['listen']);
  assert.deepEqual(leave.aliases, ['stop']);
  assert.equal(subs.find((s) => s.name === 'timestamps').permission, PermissionFlagsBits.ManageGuild);
});

// ── S110: auto-join, and pairing a voice channel with its text channel ───────

test('a channel name reduces to what it is actually called', () => {
  // Discord lowercases text-channel names and hyphenates spaces, so the same
  // room has two spellings before anyone decorates it.
  assert.equal(normalizeChannelName('Squad Room'), 'squad-room');
  assert.equal(normalizeChannelName('squad-room'), 'squad-room');
  assert.equal(normalizeChannelName('🎙️ Squad Room'), 'squad-room');
  assert.equal(normalizeChannelName('🎙️-squad-room'), 'squad-room');
  assert.equal(normalizeChannelName('・Squad Room・'), 'squad-room');
  assert.equal(normalizeChannelName('SQUAD   ROOM'), 'squad-room');
  assert.equal(normalizeChannelName('Café'), 'cafe', 'accents fold');
  assert.equal(normalizeChannelName('  '), '');
  assert.equal(normalizeChannelName(null), '');
});

const vc = (id, name, parentId = 'cat-1') => ({ id, name, parentId });
const tc = (id, name, parentId = 'cat-1') => ({ id, name, parentId });

test('a voice channel finds the text channel with the same name', () => {
  const texts = [tc('t1', 'general'), tc('t2', 'squad-room'), tc('t3', 'off-topic')];
  assert.deepEqual(pairTextChannel(vc('v1', '🎙️ Squad Room'), texts), { id: 't2', how: 'exact' });
  assert.deepEqual(pairTextChannel(vc('v1', 'General'), texts), { id: 't1', how: 'exact' });
});

test('a near-miss only counts inside the same category', () => {
  // `general` voice must not adopt `general-announcements` from the other side
  // of the server — a wrong pairing posts a private conversation in public.
  const far = [tc('t1', 'squad-room-chat', 'cat-OTHER')];
  assert.equal(pairTextChannel(vc('v1', 'Squad Room'), far), null);

  const near = [tc('t1', 'squad-room-chat', 'cat-1')];
  assert.deepEqual(pairTextChannel(vc('v1', 'Squad Room', 'cat-1'), near), { id: 't1', how: 'category' });
});

test('an exact match always beats a near one', () => {
  const texts = [tc('t1', 'squad-room-chat'), tc('t2', 'squad-room')];
  assert.deepEqual(pairTextChannel(vc('v1', 'Squad Room'), texts), { id: 't2', how: 'exact' });
});

test('two rooms with the same name: the one in this category wins', () => {
  const texts = [tc('t1', 'general', 'cat-OTHER'), tc('t2', 'general', 'cat-1')];
  assert.equal(pairTextChannel(vc('v1', 'General', 'cat-1'), texts).id, 't2');
});

test('an ambiguous near-miss is refused rather than guessed', () => {
  const texts = [tc('t1', 'squad-room-chat'), tc('t2', 'squad-room-notes')];
  assert.equal(pairTextChannel(vc('v1', 'Squad Room'), texts), null, 'two candidates is no candidate');
});

test('a nameless or unmatched channel pairs with nothing', () => {
  assert.equal(pairTextChannel(vc('v1', '🎙️'), [tc('t1', 'general')]), null);
  assert.equal(pairTextChannel(vc('v1', 'Squad Room'), []), null);
  // Never itself, even though a voice channel is text-capable.
  assert.equal(pairTextChannel(vc('v1', 'Squad Room'), [tc('v1', 'Squad Room')]), null);
});

test('auto-join obeys every switch, and names which one said no', () => {
  const on = { ...DEFAULT_TRANSCRIBE_CONFIG };
  assert.deepEqual(shouldAutoJoin({ humans: 1, channelId: 'v1' }, on), { ok: true, reason: 'ok' });

  assert.equal(shouldAutoJoin({ humans: 1, channelId: 'v1' }, { ...on, autoJoin: false }).reason, 'auto-join-off');
  assert.equal(shouldAutoJoin({ humans: 1, channelId: 'v1' }, { ...on, enabled: false }).reason, 'disabled');
  assert.equal(shouldAutoJoin({ humans: 0, channelId: 'v1' }, on).reason, 'too-quiet');
  assert.equal(
    shouldAutoJoin({ humans: 1, channelId: 'v1' }, { ...on, voiceChannelIds: ['v9'] }).reason,
    'out-of-scope',
  );
  assert.equal(shouldAutoJoin({ humans: 1, channelId: 'v9' }, { ...on, voiceChannelIds: ['v9'] }).ok, true);
  // A higher bar for a busier room.
  assert.equal(shouldAutoJoin({ humans: 1, channelId: 'v1' }, { ...on, autoJoinMinimum: 2 }).reason, 'too-quiet');
  assert.equal(shouldAutoJoin({ humans: 2, channelId: 'v1' }, { ...on, autoJoinMinimum: 2 }).ok, true);
});

test('the bot never counts itself, so it leaves an empty room', () => {
  const room = (people) => ({ members: new Map(people.map((p, i) => [`m${i}`, p])) });
  const human = { user: { bot: false } };
  const bot = { user: { bot: true } };

  assert.equal(humansIn(room([human, human, bot])), 2);
  assert.equal(humansIn(room([bot])), 0, 'the bot alone is an empty room');
  assert.equal(humansIn(undefined), 0);
  assert.equal(humansIn({ members: [human, bot] }), 1, 'a plain array works too');

  // Counting itself would leave the bot transcribing its own silence forever.
  assert.equal(shouldAutoLeave(humansIn(room([bot]))), true);
  assert.equal(shouldAutoLeave(humansIn(room([human, bot]))), false);
});

test('auto-join is on by default, because the owner asked for exactly that', () => {
  assert.equal(DEFAULT_TRANSCRIBE_CONFIG.autoJoin, true);
  assert.deepEqual(DEFAULT_TRANSCRIBE_CONFIG.voiceChannelIds, [], 'every voice channel');
  assert.equal(DEFAULT_TRANSCRIBE_CONFIG.autoJoinMinimum, 1);
});

test('the autojoin knobs exist and are Manage Server', () => {
  const subs = transcribeCommand.group.subcommands;
  for (const name of ['autojoin', 'voicechannel']) {
    const sub = subs.find((s) => s.name === name);
    assert.ok(sub, name);
    assert.equal(sub.permission, PermissionFlagsBits.ManageGuild, name);
  }
});

// ── S111: declared pairings ──────────────────────────────────────────────────

test('the owner’s committed pairings are STRINGS, not rounded numbers', () => {
  // An unquoted 18-digit snowflake is a JavaScript number, and Number cannot
  // hold it: 411633952961593345 silently becomes 411633952961593340. The map
  // then never matches a real channel and the bug is invisible in source.
  // These are the ids the owner typed, written out again on purpose — reading
  // them back off the object is exactly what would hide the rounding.
  const OWNER_PAIRS = [
    ['411633952961593345', '411634025426321438'],
    ['436248103310327808', '436248239855894538'],
    ['442066086159187978', '442059736263688213'],
    ['411634241965916191', '411634286655963146'],
  ];
  assert.equal(Object.keys(DEFAULT_VOICE_PAIRS).length, OWNER_PAIRS.length);
  for (const [voice, text] of OWNER_PAIRS) {
    assert.equal(DEFAULT_VOICE_PAIRS[voice], text, `${voice} → ${text}`);
  }
  // Every key must survive a round trip through Number without changing, or
  // it was written unquoted somewhere.
  for (const key of Object.keys(DEFAULT_VOICE_PAIRS)) {
    assert.equal(String(BigInt(key)), key, `${key} is an exact snowflake`);
    assert.match(key, /^\d{17,20}$/);
  }
});

test('a declared pairing beats even a perfect name match', () => {
  // The owner said which room goes with which. A name match is an inference;
  // a declared pairing is a fact, and an inference must never beat a fact.
  const texts = [tc('t-declared', 'nothing-alike'), tc('t-namematch', 'squad-room')];
  const pairs = { v1: 't-declared' };
  assert.deepEqual(pairTextChannel(vc('v1', 'Squad Room'), texts, pairs), {
    id: 't-declared',
    how: 'declared',
  });
  // Without the declaration the name match wins, as before.
  assert.deepEqual(pairTextChannel(vc('v1', 'Squad Room'), texts, {}), {
    id: 't-namematch',
    how: 'exact',
  });
});

test('a stale declared pairing falls through instead of posting into a void', () => {
  // The channel was deleted. Sending the transcript to an id that no longer
  // exists would silently lose it; the matcher is the better answer.
  const texts = [tc('t-namematch', 'squad-room')];
  const pairs = { v1: 't-deleted' };
  assert.deepEqual(pairTextChannel(vc('v1', 'Squad Room'), texts, pairs), {
    id: 't-namematch',
    how: 'exact',
  });
  // And with nothing to fall back on, still nothing — never the dead id.
  assert.equal(pairTextChannel(vc('v1', 'Unmatched'), texts, pairs), null);
});

test('a guild’s own pairings override the committed defaults', () => {
  const [ownerVoice] = Object.keys(DEFAULT_VOICE_PAIRS);
  const texts = [tc('t-override', 'somewhere-else'), tc(DEFAULT_VOICE_PAIRS[ownerVoice], 'the-default')];
  const merged = { ...DEFAULT_VOICE_PAIRS, [ownerVoice]: 't-override' };
  assert.equal(pairTextChannel(vc(ownerVoice, 'x'), texts, merged).id, 't-override');
});
