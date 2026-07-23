// Renders the CuffBot citation ticket — a Papers-Please-style pink slip —
// as a PNG, in pure JS. Concept credit: the "citation" cog from
// TrustyJAID/Trusty-cogs (commissioned by this project's owner), itself
// crediting gitlab.com/Saphire/citations. This file shares no code or assets
// with either; glyphs, layout, and palette are original.
import { encodePng } from './png.js';
import { ADVANCE, GLYPH_HEIGHT, eachTextPixel, textWidth } from './pixel-font.js';

// Logical canvas (scaled up at render time for crispness in Discord).
const W = 280;
const H = 170;
const SCALE = 3;

// Palette: paper pink, dark rose accents, deep ink.
const PALETTE = [
  [0xf3, 0xbf, 0xc9], // 0 background
  [0xa6, 0x5e, 0x6e], // 1 accents: perforation, dotted rules, barcode
  [0x57, 0x30, 0x3a], // 2 text ink
];

class Painter {
  constructor() {
    this.pixels = new Uint8Array(W * H); // palette indices, 0-filled
  }

  px(x, y, color) {
    if (x >= 0 && x < W && y >= 0 && y < H) this.pixels[y * W + x] = color;
  }

  rect(x, y, w, h, color) {
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) this.px(xx, yy, color);
  }

  dottedRule(y, color = 1, margin = 10) {
    for (let x = margin; x < W - margin; x += 4) this.rect(x, y, 2, 1, color);
  }

  text(str, x, y, { color = 2, scale = 1 } = {}) {
    eachTextPixel(str, (gx, gy) => this.rect(x + gx * scale, y + gy * scale, scale, scale, color));
  }

  centerText(str, y, options = {}) {
    const width = textWidth(str, options.scale ?? 1);
    this.text(str, Math.round((W - width) / 2), y, options);
  }
}

/**
 * Word-wrap text to a character budget per line. Overlong words are hard-cut.
 * Pure and exported for tests.
 */
export function wrapText(text, maxChars, maxLines) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (let word of words) {
    while (word.length > maxChars) {
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (word.length === 0) continue;
    if (line.length === 0) line = word;
    else if (line.length + 1 + word.length <= maxChars) line += ` ${word}`;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = `${last.slice(0, Math.max(0, maxChars - 1))}…`.slice(0, maxChars);
    return kept;
  }
  return lines;
}

/**
 * Render the citation ticket.
 * All inputs are strings the caller controls; the date is passed in (not read
 * from the clock here) so rendering stays deterministic and testable.
 * @param {{ to: string, reason: string, penalty?: string, officer: string,
 *           date: string, badgeSeed?: string }} input
 * @returns {{ png: Buffer, width: number, height: number }}
 */
export function renderCitation({ to, reason, penalty, officer, date, badgeSeed = '' }) {
  const p = new Painter();

  // Perforated top and bottom edges + side rails.
  for (let x = 0; x < W; x += 6) {
    p.rect(x, 0, 3, 2, 1);
    p.rect(x + 3, H - 2, 3, 2, 1);
  }
  p.rect(0, 0, 1, H, 1);
  p.rect(W - 1, 0, 1, H, 1);

  p.centerText('CUFFBOT PRECINCT', 10, { scale: 2 });
  p.centerText('CITATION', 27, { scale: 2 });
  p.dottedRule(45);

  p.text(`TO: ${to.toUpperCase()}`, 12, 52);
  p.text('VIOLATION:', 12, 66);
  const maxChars = Math.floor((W - 24) / ADVANCE); // 42 chars at scale 1
  wrapText(reason.toUpperCase(), maxChars, 3).forEach((line, i) => {
    p.text(line, 12, 76 + i * (GLYPH_HEIGHT + 3));
  });

  p.dottedRule(108);
  p.text('PENALTY:', 12, 115);
  wrapText((penalty ?? 'OFFICIAL WARNING').toUpperCase(), maxChars, 2).forEach((line, i) => {
    p.text(line, 12, 125 + i * (GLYPH_HEIGHT + 3));
  });

  p.dottedRule(146);
  p.text(`OFFICER: ${officer.toUpperCase()}`, 12, 152);
  p.text(`DATE: ${date}`, 12, 161, { scale: 1 });

  // Barcode from the badge seed's digits (a nod to the prior art) — width of
  // each bar follows the digit, so every member gets a distinct code.
  const digits = (badgeSeed.match(/\d/g) ?? ['0']).slice(-10);
  let bx = W - 14;
  for (const digit of digits) {
    const width = (Number(digit) % 3) + 1;
    bx -= width + 2;
    p.rect(bx, 150, width, 14, 1);
  }

  // Expand palette indices to RGB and encode.
  const rgb = new Uint8Array(W * SCALE * H * SCALE * 3);
  for (let y = 0; y < H * SCALE; y += 1) {
    for (let x = 0; x < W * SCALE; x += 1) {
      const color = PALETTE[p.pixels[Math.floor(y / SCALE) * W + Math.floor(x / SCALE)]];
      const offset = (y * W * SCALE + x) * 3;
      rgb[offset] = color[0];
      rgb[offset + 1] = color[1];
      rgb[offset + 2] = color[2];
    }
  }
  return { png: encodePng(rgb, W * SCALE, H * SCALE), width: W * SCALE, height: H * SCALE };
}
