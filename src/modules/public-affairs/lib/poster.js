// Renders a real WANTED poster PNG with the member's avatar composited into the
// center — pure JS (uses the enforcement pixel font + PNG encoder), so it runs
// on the Pi with no native image libraries. The avatar is passed in already
// decoded to RGB (see png-decode.js); this file only composites and draws text.
import { encodePng } from '../../enforcement/lib/png.js';
import { ADVANCE, GLYPH_HEIGHT, eachTextPixel, textWidth } from '../../enforcement/lib/pixel-font.js';
import { wrapText } from '../../enforcement/lib/citation-card.js';
import { resizeRgb } from './png-decode.js';

const W = 640;
const H = 1000;
const PAPER = [0xea, 0xdd, 0xc0];
const INK = [0x33, 0x26, 0x18];
const FRAME = [0x2a, 0x20, 0x14];
const NOPHOTO = [0xbf, 0xb2, 0x98];

function setPx(rgb, x, y, color) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  rgb[i] = color[0];
  rgb[i + 1] = color[1];
  rgb[i + 2] = color[2];
}

function fillRect(rgb, x, y, w, h, color) {
  for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) setPx(rgb, xx, yy, color);
}

function outline(rgb, x, y, w, h, thickness, color) {
  fillRect(rgb, x, y, w, thickness, color);
  fillRect(rgb, x, y + h - thickness, w, thickness, color);
  fillRect(rgb, x, y, thickness, h, color);
  fillRect(rgb, x + w - thickness, y, thickness, h, color);
}

function stampText(rgb, text, x, y, scale, color) {
  eachTextPixel(text, (gx, gy) => fillRect(rgb, x + gx * scale, y + gy * scale, scale, scale, color));
}

function centerText(rgb, text, y, scale, color) {
  stampText(rgb, text, Math.round((W - textWidth(text, scale)) / 2), y, scale, color);
}

/** Largest scale from `scales` whose rendered text fits within maxWidth. */
function fitScale(text, maxWidth, scales) {
  return scales.find((s) => textWidth(text, s) <= maxWidth) ?? scales[scales.length - 1];
}

function drawAvatar(rgb, avatar, x, y, size) {
  if (!avatar) {
    fillRect(rgb, x, y, size, size, NOPHOTO);
    centerTextIn(rgb, 'NO PHOTO', x, y + size / 2 - 8, 4, FRAME, size);
    return;
  }
  const scaled = resizeRgb(avatar.rgb, avatar.width, avatar.height, size, size);
  for (let yy = 0; yy < size; yy += 1) {
    for (let xx = 0; xx < size; xx += 1) {
      const s = (yy * size + xx) * 3;
      setPx(rgb, x + xx, y + yy, [scaled[s], scaled[s + 1], scaled[s + 2]]);
    }
  }
}

function centerTextIn(rgb, text, boxX, y, scale, color, boxW) {
  stampText(rgb, text, boxX + Math.round((boxW - textWidth(text, scale)) / 2), y, scale, color);
}

/**
 * @param {{ displayName:string, crime:string, bounty:number,
 *           avatar?: {rgb:Uint8Array,width:number,height:number}|null }} input
 * @returns {{ png: Buffer, width: number, height: number }}
 */
export function renderWantedPoster({ displayName, crime, bounty, avatar = null }) {
  const rgb = new Uint8Array(W * H * 3);
  fillRect(rgb, 0, 0, W, H, PAPER);

  // Double border.
  outline(rgb, 16, 16, W - 32, H - 32, 6, INK);
  outline(rgb, 30, 30, W - 60, H - 60, 2, INK);

  let y = 48;
  centerText(rgb, 'WANTED', y, 16, INK);
  y += 16 * GLYPH_HEIGHT + 26;
  centerText(rgb, 'DEAD OR ALIVE', y, 6, INK);
  y += 6 * GLYPH_HEIGHT + 22;

  // Framed photo.
  const box = 380;
  const bx = Math.round((W - box) / 2);
  fillRect(rgb, bx - 8, y - 8, box + 16, box + 16, FRAME);
  drawAvatar(rgb, avatar, bx, y, box);
  y += box + 30;

  // Name (shrunk to fit width).
  const name = (displayName || 'UNKNOWN').toUpperCase();
  const nameScale = fitScale(name, W - 80, [7, 6, 5, 4, 3]);
  centerText(rgb, name, y, nameScale, INK);
  y += nameScale * GLYPH_HEIGHT + 22;

  centerText(rgb, 'WANTED FOR', y, 4, INK);
  y += 4 * GLYPH_HEIGHT + 12;

  const crimeScale = 3;
  const maxChars = Math.floor((W - 80) / (ADVANCE * crimeScale));
  for (const line of wrapText((crime || 'GENERAL MISCHIEF').toUpperCase(), maxChars, 2)) {
    centerText(rgb, line, y, crimeScale, INK);
    y += crimeScale * GLYPH_HEIGHT + 8;
  }

  // Reward, pinned near the bottom and shrunk to fit.
  const reward = `REWARD ${bounty} DONUTS`;
  centerText(rgb, reward, H - 96, fitScale(reward, W - 80, [7, 6, 5, 4]), INK);

  return { png: encodePng(rgb, W, H), width: W, height: H };
}
