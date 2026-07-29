"""Pure rendering and deterministic-pick helpers for CuffAffairs.

Ported 1:1 from the Node.js CuffBot sources (public-affairs/lib/cards.js,
public-affairs/lib/poster.js, enforcement/lib/citation-card.js). Everything in
this module is synchronous and CPU-bound — the cog runs it in an executor.
"""

from __future__ import annotations

import math
from io import BytesIO
from typing import List, Optional

from PIL import Image, ImageDraw

from .pixelfont import ADVANCE, GLYPH_HEIGHT, each_text_pixel, text_width

# --- Deterministic picks (cards.js) ------------------------------------------


def hash_seed(seed: str) -> int:
    """FNV-1a 32-bit hash of a string — matches the JS implementation exactly.

    The JS version uses ``Math.imul(h, 16777619)`` and a final ``>>> 0``;
    masking to 32 bits after every multiply yields the identical result.
    """
    h = 2166136261
    for ch in str(seed):
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def _pick(items: List[str], seed: str) -> str:
    return items[hash_seed(seed) % len(items)]


CRIMES = [
    "jaywalking across the evidence locker",
    "impersonating a donut inspector",
    "excessive use of caps lock",
    "parking a patrol car on the sidewalk",
    "operating a meme without a license",
    "loitering in the #general channel",
    "reckless pinging in the third degree",
    "possession of an unregistered emoji",
]

DONUTS = [
    "a classic glazed 🍩",
    "a chocolate frosted with sprinkles 🍩",
    "a strawberry jelly-filled 🍩",
    "a maple bar 🍩",
    "a Boston cream 🍩",
    "a cinnamon sugar old-fashioned 🍩",
    "a rainbow-sprinkled birthday-cake 🍩",
    "the last donut in the break room 🍩",
]


def pick_crime(seed) -> str:
    """Deterministic crime for a seed (so the poster is stable per target)."""
    return _pick(CRIMES, f"crime:{seed}")


def pick_bounty(seed) -> int:
    """Deterministic bounty in donuts, 100-5000, rounded to the nearest 50.

    Uses ``floor(x + 0.5)`` to match JS ``Math.round`` semantics.
    """
    raw = 100 + (hash_seed(f"bounty:{seed}") % 4901)
    return int(math.floor(raw / 50 + 0.5)) * 50


def pick_donut(seed) -> str:
    """Deterministic donut for a seed."""
    return _pick(DONUTS, f"donut:{seed}")


# --- Word wrap (citation-card.js wrapText) ------------------------------------


def wrap_text(text: str, max_chars: int, max_lines: int) -> List[str]:
    """Word-wrap text to a character budget per line.

    Overlong words are hard-cut; overflow keeps ``max_lines`` lines with the
    last one truncated to end in an ellipsis. Direct port of wrapText().
    """
    words = [w for w in text.strip().split() if w]
    lines: List[str] = []
    line = ""
    for word in words:
        while len(word) > max_chars:
            if line:
                lines.append(line)
                line = ""
            lines.append(word[:max_chars])
            word = word[max_chars:]
        if not word:
            continue
        if not line:
            line = word
        elif len(line) + 1 + len(word) <= max_chars:
            line += f" {word}"
        else:
            lines.append(line)
            line = word
    if line:
        lines.append(line)
    if len(lines) > max_lines:
        kept = lines[:max_lines]
        last = kept[max_lines - 1]
        kept[max_lines - 1] = (last[: max(0, max_chars - 1)] + "…")[:max_chars]
        return kept
    return lines


# --- WANTED poster (poster.js) -------------------------------------------------

POSTER_W = 640
POSTER_H = 1000
PAPER = (0xEA, 0xDD, 0xC0)
INK = (0x33, 0x26, 0x18)
FRAME = (0x2A, 0x20, 0x14)
NOPHOTO = (0xBF, 0xB2, 0x98)


def _stamp(draw: ImageDraw.ImageDraw, text: str, x: int, y: int, scale: int, color) -> None:
    def plot(gx: int, gy: int) -> None:
        px = x + gx * scale
        py = y + gy * scale
        draw.rectangle((px, py, px + scale - 1, py + scale - 1), fill=color)

    each_text_pixel(text, plot)


def _center(draw: ImageDraw.ImageDraw, text: str, y: int, scale: int, color) -> None:
    x = _js_round((POSTER_W - text_width(text, scale)) / 2)
    _stamp(draw, text, x, y, scale, color)


def _js_round(x: float) -> int:
    """JS Math.round: halves round toward +Infinity."""
    return int(math.floor(x + 0.5))


def _fit_scale(text: str, max_width: int, scales: List[int]) -> int:
    """Largest scale from ``scales`` whose rendered text fits within max_width."""
    for s in scales:
        if text_width(text, s) <= max_width:
            return s
    return scales[-1]


def _outline(draw: ImageDraw.ImageDraw, x: int, y: int, w: int, h: int, thickness: int, color) -> None:
    """Rectangle ring drawn as four filled bars (matches Node's outline())."""
    draw.rectangle((x, y, x + w - 1, y + thickness - 1), fill=color)
    draw.rectangle((x, y + h - thickness, x + w - 1, y + h - 1), fill=color)
    draw.rectangle((x, y, x + thickness - 1, y + h - 1), fill=color)
    draw.rectangle((x + w - thickness, y, x + w - 1, y + h - 1), fill=color)


def render_wanted_poster(
    display_name: str,
    crime: str,
    bounty: int,
    avatar_bytes: Optional[bytes] = None,
) -> bytes:
    """Render the 640x1000 WANTED poster; returns PNG bytes."""
    img = Image.new("RGB", (POSTER_W, POSTER_H), PAPER)
    draw = ImageDraw.Draw(img)

    # Double border.
    _outline(draw, 16, 16, POSTER_W - 32, POSTER_H - 32, 6, INK)
    _outline(draw, 30, 30, POSTER_W - 60, POSTER_H - 60, 2, INK)

    y = 48
    _center(draw, "WANTED", y, 16, INK)
    y += 16 * GLYPH_HEIGHT + 26
    _center(draw, "DEAD OR ALIVE", y, 6, INK)
    y += 6 * GLYPH_HEIGHT + 22

    # Framed photo.
    box = 380
    bx = _js_round((POSTER_W - box) / 2)
    draw.rectangle((bx - 8, y - 8, bx - 8 + box + 16 - 1, y - 8 + box + 16 - 1), fill=FRAME)
    avatar = None
    if avatar_bytes:
        try:
            avatar = Image.open(BytesIO(avatar_bytes)).convert("RGB")
        except Exception:
            avatar = None
    if avatar is not None:
        img.paste(avatar.resize((box, box), Image.Resampling.LANCZOS), (bx, y))
    else:
        draw.rectangle((bx, y, bx + box - 1, y + box - 1), fill=NOPHOTO)
        text = "NO PHOTO"
        tx = bx + _js_round((box - text_width(text, 4)) / 2)
        _stamp(draw, text, tx, y + box // 2 - 8, 4, FRAME)
    y += box + 30

    # Name (shrunk to fit width).
    name = (display_name or "UNKNOWN").upper()
    name_scale = _fit_scale(name, POSTER_W - 80, [7, 6, 5, 4, 3])
    _center(draw, name, y, name_scale, INK)
    y += name_scale * GLYPH_HEIGHT + 22

    _center(draw, "WANTED FOR", y, 4, INK)
    y += 4 * GLYPH_HEIGHT + 12

    crime_scale = 3
    max_chars = (POSTER_W - 80) // (ADVANCE * crime_scale)  # 31 chars
    for line in wrap_text((crime or "GENERAL MISCHIEF").upper(), max_chars, 2):
        _center(draw, line, y, crime_scale, INK)
        y += crime_scale * GLYPH_HEIGHT + 8

    # Reward, pinned near the bottom and shrunk to fit.
    reward = f"REWARD {bounty} DONUTS"
    _center(draw, reward, POSTER_H - 96, _fit_scale(reward, POSTER_W - 80, [7, 6, 5, 4]), INK)

    out = BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


# --- Citation pink-slip GIF (citation-card.js) ---------------------------------

TICKET_W = 280
TICKET_H = 170
GIF_SCALE = 2

# Palette indices: 0 paper, 1 accent, 2 ink, 3 tray, 4 slot, 5 slot lip.
# Index 6 is an alias of the slot color: the Node encoder writes the final
# hold frame even though it is identical to the last riser frame, but Pillow
# merges byte-identical consecutive frames. One slot pixel of the hold frame
# uses the alias index — same RGB, different byte — to keep all 18 frames.
GIF_PALETTE = [
    (0xF3, 0xBF, 0xC9),
    (0xA6, 0x5E, 0x6E),
    (0x57, 0x30, 0x3A),
    (0x2B, 0x2B, 0x30),
    (0x14, 0x14, 0x18),
    (0x7A, 0x7A, 0x84),
    (0x14, 0x14, 0x18),
]
_IDX_ACCENT = 1
_IDX_INK = 2
_IDX_TRAY = 3
_IDX_SLOT = 4
_IDX_SLOT_LIP = 5
_IDX_SLOT_ALIAS = 6


class _Painter:
    """Palette-index pixel buffer for the logical 280x170 ticket."""

    def __init__(self) -> None:
        self.pixels = bytearray(TICKET_W * TICKET_H)  # 0-filled = paper

    def rect(self, x: int, y: int, w: int, h: int, color: int) -> None:
        for yy in range(y, y + h):
            if yy < 0 or yy >= TICKET_H:
                continue
            row = yy * TICKET_W
            for xx in range(x, x + w):
                if 0 <= xx < TICKET_W:
                    self.pixels[row + xx] = color

    def dotted_rule(self, y: int, color: int = _IDX_ACCENT, margin: int = 10) -> None:
        for x in range(margin, TICKET_W - margin, 4):
            self.rect(x, y, 2, 1, color)

    def text(self, string: str, x: int, y: int, color: int = _IDX_INK, scale: int = 1) -> None:
        each_text_pixel(
            string,
            lambda gx, gy: self.rect(x + gx * scale, y + gy * scale, scale, scale, color),
        )

    def center_text(self, string: str, y: int, color: int = _IDX_INK, scale: int = 1) -> None:
        width = text_width(string, scale)
        self.text(string, _js_round((TICKET_W - width) / 2), y, color, scale)


def _paint_citation_grid(
    to: str, reason: str, penalty: Optional[str], officer: str, date: str, badge_seed: str = ""
) -> bytearray:
    p = _Painter()

    # Perforated top and bottom edges + side rails.
    for x in range(0, TICKET_W, 6):
        p.rect(x, 0, 3, 2, _IDX_ACCENT)
        p.rect(x + 3, TICKET_H - 2, 3, 2, _IDX_ACCENT)
    p.rect(0, 0, 1, TICKET_H, _IDX_ACCENT)
    p.rect(TICKET_W - 1, 0, 1, TICKET_H, _IDX_ACCENT)

    p.center_text("CUFFBOT PRECINCT", 10, scale=2)
    p.center_text("CITATION", 27, scale=2)
    p.dotted_rule(45)

    p.text(f"TO: {to.upper()}", 12, 52)
    p.text("VIOLATION:", 12, 66)
    max_chars = (TICKET_W - 24) // ADVANCE  # 42 chars at scale 1
    for i, line in enumerate(wrap_text(reason.upper(), max_chars, 3)):
        p.text(line, 12, 76 + i * (GLYPH_HEIGHT + 3))

    p.dotted_rule(108)
    p.text("PENALTY:", 12, 115)
    for i, line in enumerate(wrap_text((penalty or "OFFICIAL WARNING").upper(), max_chars, 2)):
        p.text(line, 12, 125 + i * (GLYPH_HEIGHT + 3))

    p.dotted_rule(146)
    p.text(f"OFFICER: {officer.upper()}", 12, 152)
    p.text(f"DATE: {date}", 12, 161)

    # Barcode from the badge seed's digits — bar width follows the digit, so
    # every member gets a distinct code. Built right-to-left from x=266.
    digits = [c for c in badge_seed if c.isdigit()] or ["0"]
    bx = TICKET_W - 14
    for digit in digits[-10:]:
        width = (int(digit) % 3) + 1
        bx -= width + 2
        p.rect(bx, 150, width, 14, _IDX_ACCENT)

    return p.pixels


def _upscale_grid(grid: bytearray, w: int, h: int, scale: int) -> bytearray:
    """Nearest-neighbor upscale of a logical index grid."""
    out = bytearray(w * scale * h * scale)
    dst_w = w * scale
    for y in range(h * scale):
        src_row = (y // scale) * w
        row_off = y * dst_w
        for x in range(dst_w):
            out[row_off + x] = grid[src_row + x // scale]
    return out


def render_citation_gif(
    to: str,
    reason: str,
    penalty: Optional[str],
    officer: str,
    date: str,
    badge_seed: str = "",
    frames: int = 16,
    scale: int = GIF_SCALE,
) -> bytes:
    """Render the citation as an animated GIF that prints out of a slot.

    The ticket's bottom edge emerges first and fills toward the header, then
    the animation holds on the finished ticket. Returns GIF bytes
    (560x356 at the default scale, 18 frames, loop forever).
    """
    grid = _paint_citation_grid(to, reason, penalty, officer, date, badge_seed)
    ticket = _upscale_grid(grid, TICKET_W, TICKET_H, scale)
    ticket_w = TICKET_W * scale
    ticket_h = TICKET_H * scale
    slot_h = 8 * scale
    canvas_w = ticket_w
    canvas_h = ticket_h + slot_h

    flat_palette: List[int] = []
    for r, g, b in GIF_PALETTE:
        flat_palette.extend((r, g, b))

    def compose(revealed: int, alias_pixel: bool = False) -> Image.Image:
        buf = bytearray([_IDX_TRAY]) * (canvas_w * canvas_h)
        rows = min(revealed, ticket_h)
        for s in range(ticket_h - rows, ticket_h):
            buf[s * canvas_w : (s + 1) * canvas_w] = ticket[s * ticket_w : (s + 1) * ticket_w]
        # Slot bar along the bottom; the highlighted lip is its top edge.
        for y in range(ticket_h, canvas_h):
            color = _IDX_SLOT_LIP if y < ticket_h + scale else _IDX_SLOT
            buf[y * canvas_w : (y + 1) * canvas_w] = bytes([color]) * canvas_w
        if alias_pixel:
            buf[-1] = _IDX_SLOT_ALIAS  # same RGB as the slot; defeats frame merging
        frame = Image.frombytes("P", (canvas_w, canvas_h), bytes(buf))
        frame.putpalette(flat_palette)
        return frame

    frame_list = [compose(0)]
    durations = [300]
    for k in range(1, frames + 1):
        frame_list.append(compose(_js_round(k / frames * ticket_h)))
        durations.append(60)
    frame_list.append(compose(ticket_h, alias_pixel=True))
    durations.append(5000)

    out = BytesIO()
    frame_list[0].save(
        out,
        format="GIF",
        save_all=True,
        append_images=frame_list[1:],
        duration=durations,
        loop=0,
        disposal=1,
        optimize=False,
    )
    return out.getvalue()
