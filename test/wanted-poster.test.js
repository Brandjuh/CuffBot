import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { encodePng } from '../src/modules/enforcement/lib/png.js';
import { decodePng, resizeRgb } from '../src/modules/public-affairs/lib/png-decode.js';
import { renderWantedPoster } from '../src/modules/public-affairs/lib/poster.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function gradient(w, h) {
  const rgb = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 3;
      rgb[i] = (x * 255) / w;
      rgb[i + 1] = (y * 255) / h;
      rgb[i + 2] = 128;
    }
  }
  return rgb;
}

test('decodePng round-trips an RGB image encoded by our own encoder (all filters)', () => {
  const w = 40;
  const h = 24;
  const src = gradient(w, h);
  const decoded = decodePng(encodePng(src, w, h));
  assert.equal(decoded.width, w);
  assert.equal(decoded.height, h);
  let maxDiff = 0;
  for (let i = 0; i < src.length; i += 1) maxDiff = Math.max(maxDiff, Math.abs(src[i] - decoded.rgb[i]));
  assert.equal(maxDiff, 0, 'decoded pixels are identical to the source');
});

test('decodePng rejects a non-PNG', () => {
  assert.throws(() => decodePng(Buffer.from('not a png at all')), /signature/);
});

test('resizeRgb changes dimensions and preserves corners', () => {
  const w = 4;
  const h = 4;
  const src = gradient(w, h);
  const out = resizeRgb(src, w, h, 8, 8);
  assert.equal(out.length, 8 * 8 * 3);
  // top-left corner colour is preserved
  assert.deepEqual([out[0], out[1], out[2]], [src[0], src[1], src[2]]);
});

test('renderWantedPoster produces a valid, deterministic PNG with an avatar', () => {
  const avatar = decodePng(encodePng(gradient(64, 64), 64, 64));
  const input = { displayName: 'Suspect', crime: 'jaywalking', bounty: 1500, avatar };
  const a = renderWantedPoster(input);
  const b = renderWantedPoster(input);
  assert.ok(a.png.equals(b.png), 'same input → identical poster');
  assert.deepEqual(a.png.subarray(0, 8), PNG_SIGNATURE);
  assert.equal(a.png.readUInt32BE(16), a.width);
  assert.equal(a.png.readUInt32BE(20), a.height);
});

test('renderWantedPoster works without an avatar (placeholder) and draws ink', () => {
  const { png, width, height } = renderWantedPoster({ displayName: 'Nobody', crime: 'loitering', bounty: 200, avatar: null });
  const idatLen = png.readUInt32BE(33);
  const raw = inflateSync(png.subarray(41, 41 + idatLen));
  assert.equal(raw.length, height * (1 + width * 3));
  // The ink colour #332618 should appear (headline text etc.).
  let ink = 0;
  for (let i = 0; i < raw.length - 2; i += 1) {
    if (raw[i] === 0x33 && raw[i + 1] === 0x26 && raw[i + 2] === 0x18) ink += 1;
  }
  assert.ok(ink > 500, `expected poster ink, found ${ink}`);
});

test('renderWantedPoster shrinks a very long name to fit', () => {
  // Just needs to not throw and stay a valid PNG for an overlong name.
  const { png } = renderWantedPoster({ displayName: 'A'.repeat(40), crime: 'x', bounty: 100, avatar: null });
  assert.deepEqual(png.subarray(0, 8), PNG_SIGNATURE);
});
