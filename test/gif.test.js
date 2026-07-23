import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGif, lzwEncode } from '../src/modules/enforcement/lib/gif.js';
import { renderCitationGif } from '../src/modules/enforcement/lib/citation-card.js';

const SIG = 'GIF89a';

// Walk the GIF block structure to count image frames reliably — scanning raw
// bytes for markers is wrong because LZW image data can contain any byte.
function countFrames(buf) {
  let off = 6; // after signature
  const packed = buf[10];
  off += 7; // logical screen descriptor
  if (packed & 0x80) off += 3 * (1 << ((packed & 0x07) + 1)); // global color table
  let frames = 0;
  while (off < buf.length) {
    const block = buf[off++];
    if (block === 0x3b) break; // trailer
    if (block === 0x21) {
      off += 1; // extension label
      while (buf[off] !== 0) off += buf[off] + 1; // skip sub-blocks
      off += 1; // terminator
    } else if (block === 0x2c) {
      const imgPacked = buf[off + 8];
      off += 9; // image descriptor
      if (imgPacked & 0x80) off += 3 * (1 << ((imgPacked & 0x07) + 1)); // local color table
      off += 1; // LZW min code size
      while (buf[off] !== 0) off += buf[off] + 1; // skip image sub-blocks
      off += 1; // terminator
      frames += 1;
    } else {
      break; // unexpected
    }
  }
  return frames;
}

test('lzwEncode is deterministic and brackets output with clear/end codes', () => {
  const data = new Uint8Array([0, 0, 1, 1, 2, 2, 0, 1, 2, 0, 1, 2]);
  const a = lzwEncode(data, 2);
  const b = lzwEncode(data, 2);
  assert.deepEqual(a, b, 'same input → same output');
  // minCodeSize 2 → clear code 4 is the first code; first byte low bits carry it.
  assert.equal(a[0] & 0x07, 4 & 0x07);
  assert.ok(a.length > 0);
});

test('encodeGif writes a valid GIF89a structure', () => {
  const palette = [
    [0, 0, 0],
    [255, 255, 255],
    [255, 0, 0],
  ];
  const frames = [
    { indices: new Uint8Array([0, 1, 2, 0]), delay: 10 },
    { indices: new Uint8Array([2, 1, 0, 2]), delay: 10 },
  ];
  const gif = encodeGif({ width: 2, height: 2, palette, frames, loop: 0 });

  assert.equal(gif.subarray(0, 6).toString('latin1'), SIG);
  assert.equal(gif.readUInt16LE(6), 2, 'logical width');
  assert.equal(gif.readUInt16LE(8), 2, 'logical height');
  assert.equal(gif[gif.length - 1], 0x3b, 'trailer byte');
  assert.equal(countFrames(gif), 2, 'one graphic-control-ext per frame');
  assert.ok(gif.includes(Buffer.from('NETSCAPE2.0')), 'loop extension present');
});

test('encodeGif rejects out-of-range palettes', () => {
  assert.throws(() => encodeGif({ width: 1, height: 1, palette: [[0, 0, 0]], frames: [] }), /at least 2/);
  const big = Array.from({ length: 257 }, () => [0, 0, 0]);
  assert.throws(() => encodeGif({ width: 1, height: 1, palette: big, frames: [] }), /256/);
});

const INPUT = {
  to: 'Suspect',
  reason: 'Jaywalking across the evidence locker',
  officer: 'brand',
  date: '2026-07-23',
  badgeSeed: '412676658991071243',
};

test('renderCitationGif is deterministic and well-formed', () => {
  const a = renderCitationGif(INPUT);
  const b = renderCitationGif(INPUT);
  assert.ok(a.gif.equals(b.gif), 'same input → identical GIF');
  assert.equal(a.gif.subarray(0, 6).toString('latin1'), SIG);
  assert.equal(a.gif[a.gif.length - 1], 0x3b);
  // 1 empty + 16 reveal + 1 hold = 18 frames by default.
  assert.equal(countFrames(a.gif), 18);
  assert.ok(a.gif.length < 2 * 1024 * 1024, 'GIF well under Discord upload limits');
});

test('renderCitationGif output varies with the citation content', () => {
  const a = renderCitationGif(INPUT);
  const b = renderCitationGif({ ...INPUT, reason: 'Different violation entirely' });
  assert.ok(!a.gif.equals(b.gif));
});
