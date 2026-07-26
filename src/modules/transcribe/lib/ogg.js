// An Ogg container for Opus packets (S102 = M21.2). Pure, ~150 lines, no
// dependencies — and the reason the live-voice half needs no audio decoder at
// all: Discord's receiver hands over Opus packets, Groq accepts Ogg/Opus, so
// the only missing piece is the container between them. Decoding to PCM would
// have meant a native opus binding (a compiler on the Pi) or opusscript (pure
// JS but slow), for no gain.
//
// Written here rather than taken from prism-media because @discordjs/voice
// bundles prism-media **1.3.5**, whose `opus` export is Decoder/Encoder/
// OggDemuxer/WebmDemuxer — `OggLogicalBitstream` only exists in the 2.x alpha.
// Verified before writing a line of this file, not assumed.
//
// Format reference: RFC 3533 (Ogg) and RFC 7845 (Ogg Opus).

const CAPTURE = Buffer.from('OggS');
const HEADER_BYTES = 27; // through page_segments
const MAX_SEGMENTS = 255;

/** Opus is always 48 kHz in Discord, and every frame it sends is 20 ms. */
export const SAMPLE_RATE = 48_000;
export const SAMPLES_PER_FRAME = 960;

/**
 * Ogg's CRC is its own variant: polynomial 0x04c11db7, initial value 0, no
 * reflection of input or output, and no final xor. It is NOT the CRC-32 that
 * zlib computes, which is why this table is built here rather than reused.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let crc = i << 24;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000_0000 ? ((crc << 1) ^ 0x04c1_1db7) >>> 0 : (crc << 1) >>> 0;
    }
    table[i] = crc >>> 0;
  }
  return table;
})();

export function oggCrc32(buffer) {
  let crc = 0;
  for (const byte of buffer) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

/**
 * The Ogg lacing values for one packet: ⌊len/255⌋ segments of 255 followed by
 * one of len mod 255. A packet whose length is an exact multiple of 255
 * therefore ends in a 0 — that terminating zero is what tells a reader the
 * packet finished rather than continuing onto the next page.
 */
export function lacing(length) {
  const values = [];
  let left = length;
  while (left >= 255) {
    values.push(255);
    left -= 255;
  }
  values.push(left);
  return values;
}

/**
 * One Ogg page.
 * @param {object} page
 * @param {Buffer[]} page.packets packets wholly contained in this page
 * @param {bigint|number} page.granule samples decodable at the end of the page
 * @param {number} page.serial the logical bitstream id
 * @param {number} page.sequence page counter, from 0
 * @param {boolean} [page.first] beginning-of-stream
 * @param {boolean} [page.last] end-of-stream
 */
export function buildPage({ packets, granule, serial, sequence, first = false, last = false }) {
  const segments = packets.flatMap((p) => lacing(p.length));
  if (segments.length > MAX_SEGMENTS) {
    throw new Error(`Ogg page needs ${segments.length} segments; the format allows ${MAX_SEGMENTS}`);
  }
  const payload = Buffer.concat(packets);
  const page = Buffer.alloc(HEADER_BYTES + segments.length + payload.length);

  CAPTURE.copy(page, 0);
  page[4] = 0; // stream structure version
  page[5] = (first ? 0x02 : 0) | (last ? 0x04 : 0);
  page.writeBigUInt64LE(BigInt(granule), 6);
  page.writeUInt32LE(serial >>> 0, 14);
  page.writeUInt32LE(sequence >>> 0, 18);
  page.writeUInt32LE(0, 22); // CRC is computed over the page with this zeroed
  page[26] = segments.length;
  Buffer.from(segments).copy(page, HEADER_BYTES);
  payload.copy(page, HEADER_BYTES + segments.length);

  page.writeUInt32LE(oggCrc32(page), 22);
  return page;
}

/**
 * The OpusHead identification header (RFC 7845 §5.1).
 * `preSkip` is how many samples a decoder should discard; 3840 (80 ms) is what
 * the reference encoder emits and what every player expects to see.
 */
export function opusHead({ channels = 2, preSkip = 3840, sampleRate = SAMPLE_RATE } = {}) {
  const head = Buffer.alloc(19);
  head.write('OpusHead', 0, 'ascii');
  head[8] = 1; // version
  head[9] = channels;
  head.writeUInt16LE(preSkip, 10);
  head.writeUInt32LE(sampleRate, 12);
  head.writeInt16LE(0, 16); // output gain
  head[18] = 0; // channel mapping family 0
  return head;
}

/** The OpusTags comment header (RFC 7845 §5.2) — vendor string, no comments. */
export function opusTags(vendor = 'CuffBot') {
  const name = Buffer.from(vendor, 'utf8');
  const tags = Buffer.alloc(8 + 4 + name.length + 4);
  tags.write('OpusTags', 0, 'ascii');
  tags.writeUInt32LE(name.length, 8);
  name.copy(tags, 12);
  tags.writeUInt32LE(0, 12 + name.length); // user comment count
  return tags;
}

/**
 * Wrap a run of Opus packets into a complete Ogg Opus file.
 *
 * Every packet Discord sends is a 20 ms frame, so the granule position simply
 * counts frames × 960 — no need to parse the TOC byte for a frame size that is
 * always the same. A packet that will not fit in the current page starts a new
 * one; the last page carries the end-of-stream flag, which is what makes the
 * result a finished file rather than a truncated stream.
 *
 * @param {Buffer[]} packets in arrival order
 * @param {{ channels?: number, serial?: number }} [options]
 * @returns {Buffer} a complete .ogg file
 */
export function encodeOggOpus(packets, { channels = 2, serial = 1 } = {}) {
  const pages = [];
  let sequence = 0;

  pages.push(buildPage({ packets: [opusHead({ channels })], granule: 0, serial, sequence: sequence++, first: true }));
  pages.push(buildPage({ packets: [opusTags()], granule: 0, serial, sequence: sequence++ }));

  let batch = [];
  let batchSegments = 0;
  let granule = 0;

  const flush = (last) => {
    pages.push(buildPage({ packets: batch, granule, serial, sequence: sequence++, last }));
    batch = [];
    batchSegments = 0;
  };

  for (const packet of packets) {
    const needed = lacing(packet.length).length;
    if (needed > MAX_SEGMENTS) {
      throw new Error(`a single Opus packet of ${packet.length} bytes cannot fit one Ogg page`);
    }
    if (batchSegments + needed > MAX_SEGMENTS) flush(false);
    batch.push(packet);
    batchSegments += needed;
    granule += SAMPLES_PER_FRAME;
  }
  // Always emit a final page, even for an empty capture: a stream needs an
  // end-of-stream marker to be a file.
  flush(true);

  return Buffer.concat(pages);
}

/** How long a capture is, in seconds, from its packet count. */
export const durationOf = (packets) => (packets.length * SAMPLES_PER_FRAME) / SAMPLE_RATE;
