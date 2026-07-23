// Minimal PNG decoder — pure Node (node:zlib), zero dependencies. Enough to
// read a Discord avatar (requested as an 8-bit, non-interlaced PNG) into RGB so
// it can be composited onto the WANTED poster. Handles color types grayscale,
// RGB, palette, grayscale+alpha, and RGBA at bit depth 8; alpha is composited
// over white (avatars are opaque squares, but rounded/transparent PNGs stay sane).
import { inflateSync } from 'node:zlib';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/**
 * Decode a PNG buffer to flat RGB.
 * @param {Buffer|Uint8Array} buffer
 * @returns {{ width: number, height: number, rgb: Uint8Array }}
 */
export function decodePng(buffer) {
  const buf = Buffer.from(buffer);
  for (let i = 0; i < 8; i += 1) {
    if (buf[i] !== SIGNATURE[i]) throw new Error('not a PNG (bad signature)');
  }

  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette = null;
  const idat = [];

  let off = 8;
  while (off < buf.length) {
    const length = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + length; // length + type + data + crc
  }

  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth} (need 8)`);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = CHANNELS[colorType];
  if (!channels) throw new Error(`unsupported PNG color type ${colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(height * stride);

  // Un-filter each scanline in place.
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const rowStart = y * (stride + 1) + 1;
    for (let x = 0; x < stride; x += 1) {
      const value = raw[rowStart + x];
      const a = x >= channels ? pixels[y * stride + x - channels] : 0;
      const b = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0;
      let recon;
      switch (filter) {
        case 0: recon = value; break;
        case 1: recon = value + a; break;
        case 2: recon = value + b; break;
        case 3: recon = value + ((a + b) >> 1); break;
        case 4: recon = value + paeth(a, b, c); break;
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      pixels[y * stride + x] = recon & 0xff;
    }
  }

  // Convert to RGB (alpha composited over white).
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    let r;
    let g;
    let bl;
    let alpha = 255;
    const p = i * channels;
    if (colorType === 0) {
      r = g = bl = pixels[p];
    } else if (colorType === 2) {
      r = pixels[p];
      g = pixels[p + 1];
      bl = pixels[p + 2];
    } else if (colorType === 3) {
      const idx = pixels[p] * 3;
      r = palette[idx];
      g = palette[idx + 1];
      bl = palette[idx + 2];
    } else if (colorType === 4) {
      r = g = bl = pixels[p];
      alpha = pixels[p + 1];
    } else {
      r = pixels[p];
      g = pixels[p + 1];
      bl = pixels[p + 2];
      alpha = pixels[p + 3];
    }
    if (alpha !== 255) {
      const t = alpha / 255;
      r = Math.round(r * t + 255 * (1 - t));
      g = Math.round(g * t + 255 * (1 - t));
      bl = Math.round(bl * t + 255 * (1 - t));
    }
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = bl;
  }

  return { width, height, rgb };
}

/**
 * Fetch an avatar URL and decode it to RGB. Returns null on any failure
 * (network, non-PNG, unsupported PNG) so the poster can fall back to a
 * placeholder rather than the command failing.
 * @param {string} url a PNG URL (request Discord avatars with extension 'png')
 * @returns {Promise<{width:number,height:number,rgb:Uint8Array}|null>}
 */
export async function fetchAvatarRgb(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return decodePng(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

/** Nearest-neighbor resize of a flat RGB image. */
export function resizeRgb(rgb, srcW, srcH, dstW, dstH) {
  const out = new Uint8Array(dstW * dstH * 3);
  for (let y = 0; y < dstH; y += 1) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x += 1) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const s = (sy * srcW + sx) * 3;
      const d = (y * dstW + x) * 3;
      out[d] = rgb[s];
      out[d + 1] = rgb[s + 1];
      out[d + 2] = rgb[s + 2];
    }
  }
  return out;
}
