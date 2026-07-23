// Minimal animated GIF89a encoder — pure JS, zero dependencies (same reason as
// png.js: native image libs do not build reliably on a Pi). Supports a global
// palette of up to 256 colors, per-frame delays, and infinite looping via the
// NETSCAPE2.0 extension. Frames are palette-index buffers (one byte per pixel).

// --- LZW compression (GIF variable-width codes) ------------------------------

class BitWriter {
  constructor() {
    this.bytes = [];
    this.cur = 0;
    this.n = 0;
  }
  write(code, width) {
    this.cur |= code << this.n;
    this.n += width;
    while (this.n >= 8) {
      this.bytes.push(this.cur & 0xff);
      this.cur >>= 8;
      this.n -= 8;
    }
  }
  flush() {
    if (this.n > 0) {
      this.bytes.push(this.cur & 0xff);
      this.cur = 0;
      this.n = 0;
    }
  }
}

/**
 * LZW-encode index data at the given minimum code size (>=2). Dictionary keys
 * are integers ((prefixCode << 8) | pixel) rather than strings — a large speed
 * win when encoding the hundreds of thousands of pixels in an animation frame.
 * @param {Uint8Array|number[]} indices palette indices (< 256)
 * @returns {number[]} raw code bytes (not yet sub-blocked)
 */
export function lzwEncode(indices, minCodeSize) {
  const clearCode = 1 << minCodeSize;
  const endCode = clearCode + 1;
  const writer = new BitWriter();
  let codeWidth = minCodeSize + 1;
  let dict = new Map();
  let next = endCode + 1;

  const reset = () => {
    dict = new Map();
    next = endCode + 1;
    codeWidth = minCodeSize + 1;
  };

  reset();
  writer.write(clearCode, codeWidth);

  // Base codes 0..clearCode-1 are the pixel values themselves, so a running
  // "prefix" is always a code and needs no lookup to start.
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const k = indices[i];
    const key = (prefix << 8) | k; // prefix < 4096, k < 256 → fits in a small int
    const existing = dict.get(key);
    if (existing !== undefined) {
      prefix = existing;
    } else {
      writer.write(prefix, codeWidth);
      dict.set(key, next);
      if (next === 1 << codeWidth && codeWidth < 12) codeWidth += 1;
      next += 1;
      if (next > 4095) {
        writer.write(clearCode, codeWidth);
        reset();
      }
      prefix = k;
    }
  }
  writer.write(prefix, codeWidth);
  writer.write(endCode, codeWidth);
  writer.flush();
  return writer.bytes;
}

// --- GIF assembly ------------------------------------------------------------

function subBlockify(bytes) {
  const out = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255);
    out.push(chunk.length, ...chunk);
  }
  out.push(0); // block terminator
  return out;
}

function u16(n) {
  return [n & 0xff, (n >> 8) & 0xff];
}

/**
 * @param {{ width:number, height:number, palette:number[][],
 *           frames:Array<{indices:Uint8Array|number[], delay:number}>, loop?:number }} spec
 *   palette: array of [r,g,b]; delay: centiseconds; loop: 0 = forever (default).
 * @returns {Buffer}
 */
export function encodeGif({ width, height, palette, frames, loop = 0 }) {
  if (palette.length < 2) throw new Error('GIF palette needs at least 2 colors');
  if (palette.length > 256) throw new Error('GIF palette limited to 256 colors');

  // Global color table size must be a power of two >= palette length.
  let gctBits = 1;
  while (1 << gctBits < palette.length) gctBits += 1;
  const gctSize = 1 << gctBits;
  const minCodeSize = Math.max(2, gctBits);

  const bytes = [];
  const push = (...b) => bytes.push(...b);
  const pushStr = (s) => {
    for (const ch of s) bytes.push(ch.charCodeAt(0));
  };

  pushStr('GIF89a');
  push(...u16(width), ...u16(height));
  push(0x80 | ((gctBits - 1) & 0x07)); // global color table flag + size
  push(0, 0); // background color index, pixel aspect ratio

  for (let i = 0; i < gctSize; i += 1) {
    const c = palette[i] ?? [0, 0, 0];
    push(c[0] & 0xff, c[1] & 0xff, c[2] & 0xff);
  }

  // NETSCAPE looping extension.
  push(0x21, 0xff, 0x0b);
  pushStr('NETSCAPE2.0');
  push(0x03, 0x01, ...u16(loop), 0x00);

  for (const frame of frames) {
    // Graphic control extension (delay + no disposal).
    push(0x21, 0xf9, 0x04, 0x00, ...u16(frame.delay ?? 8), 0x00, 0x00);
    // Image descriptor.
    push(0x2c, ...u16(0), ...u16(0), ...u16(width), ...u16(height), 0x00);
    push(minCodeSize);
    const codes = lzwEncode(frame.indices, minCodeSize);
    push(...subBlockify(codes));
  }

  push(0x3b); // trailer
  return Buffer.from(bytes);
}
