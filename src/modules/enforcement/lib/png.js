// Minimal PNG encoder — pure Node (node:zlib), zero dependencies.
// Exists so citation tickets can be rendered on any hardware the owner runs
// (a Raspberry Pi): native image libraries (canvas/sharp) need platform
// builds that regularly fail there, and a 8-bit pixel ticket does not need
// them. Encodes 8-bit/channel RGB, filter 0 scanlines.
import { deflateSync } from 'node:zlib';

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});

/** CRC32 as PNG requires it (over chunk type + data). */
export function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/**
 * Encode raw RGB pixels into a PNG file buffer.
 * @param {Uint8Array} rgb 3 bytes per pixel, row-major, length w*h*3
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function encodePng(rgb, width, height) {
  if (rgb.length !== width * height * 3) {
    throw new Error(`pixel buffer is ${rgb.length} bytes, expected ${width * height * 3}`);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor RGB
  // compression 0, filter 0, interlace 0 already zeroed

  // Every scanline gets a leading filter byte (0 = None).
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (1 + width * 3);
    raw[rowStart] = 0;
    raw.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), rowStart + 1);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
