import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { crc32, encodePng } from '../src/modules/enforcement/lib/png.js';
import { textWidth } from '../src/modules/enforcement/lib/pixel-font.js';
import { renderCitation } from '../src/modules/enforcement/lib/citation-card.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function ihdrDimensions(png) {
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

test('encodePng produces a structurally valid PNG', () => {
  const w = 4;
  const h = 3;
  const rgb = new Uint8Array(w * h * 3).fill(200);
  const png = encodePng(rgb, w, h);

  assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
  assert.deepEqual(ihdrDimensions(png), { width: 4, height: 3 });

  // IHDR CRC must verify (bytes 12..29 = type+data, CRC at 29..33).
  const ihdrBody = png.subarray(12, 29);
  assert.equal(png.readUInt32BE(29), crc32(ihdrBody));

  // IDAT must inflate back to h scanlines of 1 filter byte + w*3 pixels.
  const idatLength = png.readUInt32BE(33);
  const idat = png.subarray(41, 41 + idatLength);
  const raw = inflateSync(idat);
  assert.equal(raw.length, h * (1 + w * 3));
});

test('encodePng rejects a wrong-sized buffer', () => {
  assert.throws(() => encodePng(new Uint8Array(5), 4, 3), /expected/);
});

test('textWidth is consistent with the 6px advance', () => {
  assert.equal(textWidth(''), 0);
  assert.equal(textWidth('A'), 5);
  assert.equal(textWidth('AB'), 11);
  assert.equal(textWidth('AB', 2), 22);
});

const INPUT = {
  to: 'Suspect',
  reason: 'Parking a patrol car on the donut lane',
  officer: 'brand',
  date: '2026-07-23',
  badgeSeed: '412676658991071243',
};

test('renderCitation is deterministic for identical input', () => {
  const a = renderCitation(INPUT);
  const b = renderCitation(INPUT);
  assert.ok(a.png.equals(b.png));
  assert.deepEqual(ihdrDimensions(a.png), { width: 840, height: 510 });
});

test('renderCitation output varies with the reason', () => {
  const a = renderCitation(INPUT);
  const b = renderCitation({ ...INPUT, reason: 'Jaywalking' });
  assert.ok(!a.png.equals(b.png));
});

test('renderCitation draws ink (not an empty pink sheet)', () => {
  const { png } = renderCitation(INPUT);
  const idatLength = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLength));
  // Count pixels matching the ink color #57303A.
  let ink = 0;
  for (let i = 0; i < raw.length - 2; i += 1) {
    if (raw[i] === 0x57 && raw[i + 1] === 0x30 && raw[i + 2] === 0x3a) ink += 1;
  }
  assert.ok(ink > 1000, `expected substantial ink, found ${ink} matches`);
});
