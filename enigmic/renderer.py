"""Board rendering with Pillow.

The static board (rooms, walls, blocked cells, objects, features, labels,
legend) is drawn once per case and cached; the dynamic layer (characters,
X marks, per-character notes) is composited on top for every update.

Design notes:

* Accessibility does not rely on color alone - rooms get both a background
  tint and a printed name, walls use a distinct thick stroke, blocked cells
  are hatched, and all characters render as high-contrast lettered tokens.
* No font files are bundled.  A few well-known system font locations are
  tried and Pillow's built-in default font is the safe fallback.

This module imports Pillow but never discord or redbot.  Callers on the
event loop must run :func:`render_board_png` in a thread executor.
"""

from __future__ import annotations

import io
from typing import Iterable, Mapping

from PIL import Image, ImageDraw, ImageFont

from .constraints import CaseGeometry
from .coordinates import Cell
from .models import Case

# Cell geometry ------------------------------------------------------------

_MIN_CELL = 90
_MAX_CELL = 150
_TARGET_BOARD_WIDTH = 1100
_MARGIN_LEFT = 44
_MARGIN_TOP = 44
_MARGIN_RIGHT = 20
_LEGEND_PAD = 14

#: Caps on the legend so a case with pathological data cannot make the
#: rendered image grow without bound.
_MAX_LEGEND_FEATURES = 12
_MAX_LEGEND_OBJECTS = 16
_MAX_LEGEND_LINES = 8

# A colorblind-friendly pastel palette for room backgrounds.  Rooms are also
# labeled with their names, so color is never the only signal.
_ROOM_COLORS = [
    (222, 235, 247),  # pale blue
    (229, 245, 224),  # pale green
    (254, 230, 206),  # pale orange
    (239, 237, 245),  # pale purple
    (255, 245, 204),  # pale yellow
    (253, 224, 221),  # pale rose
    (224, 243, 243),  # pale teal
    (240, 240, 232),  # pale sand
]

_GRID_LINE = (150, 150, 150)
_ROOM_BORDER = (60, 60, 60)
_WALL_COLOR = (139, 35, 35)
_BLOCKED_FILL = (120, 120, 120)
_TEXT_DARK = (25, 25, 25)
_TEXT_MUTED = (90, 90, 90)
_SUSPECT_FILL = (255, 255, 255)
_SUSPECT_RING = (35, 35, 35)
_VICTIM_FILL = (45, 45, 45)
_VICTIM_TEXT = (255, 255, 255)
_X_COLOR = (110, 110, 110)
_NOTE_COLOR = (170, 60, 60)

_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/System/Library/Fonts/Helvetica.ttc",
    "C:\\Windows\\Fonts\\arial.ttf",
)

_font_cache: dict[int, ImageFont.ImageFont] = {}
_background_cache: dict[tuple[str, int, int], Image.Image] = {}
_BACKGROUND_CACHE_LIMIT = 16


def _load_font(size: int) -> ImageFont.ImageFont:
    """Load a system font at ``size``, falling back to Pillow's default."""
    cached = _font_cache.get(size)
    if cached is not None:
        return cached
    font: ImageFont.ImageFont | None = None
    for path in _FONT_CANDIDATES:
        try:
            font = ImageFont.truetype(path, size)
            break
        except OSError:
            continue
    if font is None:
        try:
            font = ImageFont.load_default(size=size)
        except TypeError:  # older Pillow without the size parameter
            font = ImageFont.load_default()
    _font_cache[size] = font
    return font


def _cell_size(size: int) -> int:
    return max(_MIN_CELL, min(_MAX_CELL, _TARGET_BOARD_WIDTH // size))


def _cell_box(cell: Cell, cell_px: int) -> tuple[int, int, int, int]:
    row, col = cell
    x0 = _MARGIN_LEFT + col * cell_px
    y0 = _MARGIN_TOP + row * cell_px
    return x0, y0, x0 + cell_px, y0 + cell_px


def _text_center(
    draw: ImageDraw.ImageDraw,
    center: tuple[float, float],
    text: str,
    font: ImageFont.ImageFont,
    fill,
) -> None:
    draw.text(center, text, font=font, fill=fill, anchor="mm")


# ---------------------------------------------------------------------------
# Static background
# ---------------------------------------------------------------------------


def _room_color_map(case: Case) -> dict[str, tuple[int, int, int]]:
    return {
        room.id: _ROOM_COLORS[index % len(_ROOM_COLORS)]
        for index, room in enumerate(case.rooms)
    }


def _wrap_line(draw: ImageDraw.ImageDraw, text: str, font: ImageFont.ImageFont,
               max_width: int) -> list[str]:
    """Word-wrap ``text`` so every line fits within ``max_width`` pixels."""
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        attempt = f"{current} {word}".strip()
        if current and draw.textlength(attempt, font=font) > max_width:
            lines.append(current)
            current = word
        else:
            current = attempt
    if current:
        lines.append(current)
    return lines or [""]


def _legend_lines(case: Case) -> list[str]:
    lines: list[str] = []
    if case.objects:
        shown_objects = [
            f"{obj.symbol or obj.id[:2].upper()} = {obj.name[:40]}"
            for obj in case.objects[:_MAX_LEGEND_OBJECTS]
        ]
        hidden = len(case.objects) - len(shown_objects)
        if hidden > 0:
            shown_objects.append(f"+{hidden} more")
        lines.append("Objects: " + ", ".join(shown_objects))
    if case.cell_features:
        features = sorted({name for names in case.cell_features.values() for name in names})
        shown = [f.replace("_", " ") for f in features[:_MAX_LEGEND_FEATURES]]
        remaining = len(features) - len(shown)
        if remaining > 0:
            shown.append(f"+{remaining} more")
        lines.append("Floor: " + ", ".join(shown))
    lines.append(
        "Dark token = victim, light tokens = suspects, "
        "thick dark red edge = wall, hatched cell = blocked."
    )
    return lines


def _draw_background(case: Case, geometry: CaseGeometry) -> Image.Image:
    size = case.size
    cell_px = _cell_size(size)
    board_px = size * cell_px
    label_font = _load_font(max(16, cell_px // 6))
    small_font = _load_font(max(13, cell_px // 8))
    tiny_font = _load_font(max(11, cell_px // 9))
    legend_font = _load_font(15)

    width = _MARGIN_LEFT + board_px + _MARGIN_RIGHT
    measurer = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    legend_lines = [
        wrapped
        for raw in _legend_lines(case)
        for wrapped in _wrap_line(measurer, raw, legend_font,
                                  width - _MARGIN_LEFT - _MARGIN_RIGHT)
    ][:_MAX_LEGEND_LINES]
    legend_height = _LEGEND_PAD * 2 + len(legend_lines) * 20
    height = _MARGIN_TOP + board_px + legend_height + 8

    image = Image.new("RGB", (width, height), (250, 250, 250))
    draw = ImageDraw.Draw(image)
    room_colors = _room_color_map(case)

    # Room fills.
    for cell in ((r, c) for r in range(size) for c in range(size)):
        room_id = geometry.room_of.get(cell)
        color = room_colors.get(room_id, (240, 240, 240))
        draw.rectangle(_cell_box(cell, cell_px), fill=color)

    # Feature markers: a dotted inner border plus the feature initials.
    for cell, names in case.cell_features.items():
        x0, y0, x1, y1 = _cell_box(cell, cell_px)
        inset = 6
        for x in range(x0 + inset, x1 - inset, 8):
            draw.line([(x, y0 + inset), (x + 3, y0 + inset)], fill=_TEXT_MUTED, width=1)
            draw.line([(x, y1 - inset), (x + 3, y1 - inset)], fill=_TEXT_MUTED, width=1)
        for y in range(y0 + inset, y1 - inset, 8):
            draw.line([(x0 + inset, y), (x0 + inset, y + 3)], fill=_TEXT_MUTED, width=1)
            draw.line([(x1 - inset, y), (x1 - inset, y + 3)], fill=_TEXT_MUTED, width=1)
        # Skip empty parts: "salt__stain" or a trailing underscore is an
        # ordinary authoring typo and must not crash the render.
        initials = "/".join(
            "".join(part[0] for part in name.split("_") if part)[:3].upper()
            for name in names
        )
        draw.text((x0 + 8, y1 - 8), initials, font=tiny_font,
                  fill=_TEXT_MUTED, anchor="lb")

    # Blocked cells: hatching over the room color.
    for cell in ((r, c) for r in range(size) for c in range(size)):
        if cell in geometry.walkable:
            continue
        x0, y0, x1, y1 = _cell_box(cell, cell_px)
        draw.rectangle((x0, y0, x1, y1), fill=(205, 205, 205))
        step = 10
        for offset in range(-cell_px, cell_px, step):
            draw.line(
                [(max(x0, x0 + offset), y0 + max(0, -offset)),
                 (min(x1, x0 + offset + cell_px), y0 + min(cell_px, cell_px - offset))],
                fill=_BLOCKED_FILL,
                width=2,
            )

    # Grid lines.
    for index in range(size + 1):
        x = _MARGIN_LEFT + index * cell_px
        y = _MARGIN_TOP + index * cell_px
        draw.line([(x, _MARGIN_TOP), (x, _MARGIN_TOP + board_px)], fill=_GRID_LINE, width=1)
        draw.line([(_MARGIN_LEFT, y), (_MARGIN_LEFT + board_px, y)], fill=_GRID_LINE, width=1)

    # Room boundaries: thick lines wherever two adjacent cells differ in room,
    # plus the outer border.
    for row in range(size):
        for col in range(size):
            cell = (row, col)
            x0, y0, x1, y1 = _cell_box(cell, cell_px)
            room_id = geometry.room_of.get(cell)
            if col + 1 < size and geometry.room_of.get((row, col + 1)) != room_id:
                draw.line([(x1, y0), (x1, y1)], fill=_ROOM_BORDER, width=4)
            if row + 1 < size and geometry.room_of.get((row + 1, col)) != room_id:
                draw.line([(x0, y1), (x1, y1)], fill=_ROOM_BORDER, width=4)
    draw.rectangle(
        (_MARGIN_LEFT, _MARGIN_TOP, _MARGIN_LEFT + board_px, _MARGIN_TOP + board_px),
        outline=_ROOM_BORDER,
        width=4,
    )

    # Explicit walls: thick dark red strokes on the shared edge.
    for a, b in geometry.walls:
        (ar, ac), (br, bc) = a, b
        ax0, ay0, ax1, ay1 = _cell_box(a, cell_px)
        if ar == br:  # vertical edge between horizontally adjacent cells
            x = ax1 if bc > ac else ax0
            draw.line([(x, ay0 + 2), (x, ay1 - 2)], fill=_WALL_COLOR, width=7)
        else:  # horizontal edge between vertically adjacent cells
            y = ay1 if br > ar else ay0
            draw.line([(ax0 + 2, y), (ax1 - 2, y)], fill=_WALL_COLOR, width=7)

    # Coordinate labels.
    for col in range(size):
        x = _MARGIN_LEFT + col * cell_px + cell_px / 2
        _text_center(draw, (x, _MARGIN_TOP / 2), "ABCDEFGH"[col], label_font, _TEXT_DARK)
    for row in range(size):
        y = _MARGIN_TOP + row * cell_px + cell_px / 2
        _text_center(draw, (_MARGIN_LEFT / 2, y), str(row + 1), label_font, _TEXT_DARK)

    # Room name labels.
    for room in case.rooms:
        x0, y0, x1, y1 = _cell_box(room.render_label_cell, cell_px)
        name = room.name
        max_chars = max(4, (cell_px - 8) // max(6, small_font.size // 2))
        if len(name) > max_chars:
            name = name[: max_chars - 1] + "."
        draw.text((x0 + 5, y0 + 3), name, font=small_font, fill=_TEXT_MUTED)

    # Object symbols.  A blocking object owns its cell, so it is drawn in the
    # middle; a walkable object shares the cell with a possible character
    # token, so it is tucked into the bottom-right corner where the round
    # token cannot cover it (feature initials use bottom-left, notes use
    # top-right, room labels use top-left).
    for game_object in case.objects:
        x0, y0, x1, y1 = _cell_box(game_object.cell, cell_px)
        symbol = game_object.symbol or game_object.id[:2].upper()
        if game_object.blocks_movement:
            box_w = max(26, len(symbol) * 12 + 8)
            bx0 = x0 + (cell_px - box_w) / 2
            by0 = y0 + cell_px / 2 - 12
            box_h = 24
            font = small_font
        else:
            box_w = max(22, len(symbol) * 9 + 6)
            box_h = 18
            bx0 = x1 - box_w - 4
            by0 = y1 - box_h - 4
            font = tiny_font
        draw.rounded_rectangle(
            (bx0, by0, bx0 + box_w, by0 + box_h),
            radius=5,
            fill=(235, 228, 214),
            outline=_TEXT_DARK,
            width=2,
        )
        _text_center(draw, (bx0 + box_w / 2, by0 + box_h / 2), symbol, font,
                     _TEXT_DARK)

    # Legend.
    y = _MARGIN_TOP + board_px + _LEGEND_PAD
    for line in legend_lines:
        draw.text((_MARGIN_LEFT, y), line, font=legend_font, fill=_TEXT_DARK)
        y += 20

    return image


def _get_background(case: Case, geometry: CaseGeometry) -> Image.Image:
    # Content-keyed: see Case.fingerprint.  Two guilds can hold different
    # custom cases under one ID, so an ID-based key would serve one guild's
    # board to another.
    key = (case.id, case.fingerprint)
    cached = _background_cache.get(key)
    if cached is None:
        cached = _draw_background(case, geometry)
        if len(_background_cache) >= _BACKGROUND_CACHE_LIMIT:
            _background_cache.pop(next(iter(_background_cache)))
        _background_cache[key] = cached
    return cached


def clear_background_cache(case_id: str | None = None) -> None:
    """Drop cached backgrounds (all of them, or those for one case)."""
    if case_id is None:
        _background_cache.clear()
        return
    for key in [k for k in _background_cache if k[0] == case_id]:
        _background_cache.pop(key, None)


# ---------------------------------------------------------------------------
# Dynamic layer
# ---------------------------------------------------------------------------


def render_board_png(
    case: Case,
    geometry: CaseGeometry,
    *,
    placements: Mapping[str, Cell] | None = None,
    global_exclusions: Iterable[Cell] = (),
    character_exclusions: Iterable[Cell] = (),
    selected_symbol: str | None = None,
) -> bytes:
    """Render the full board as PNG bytes.

    ``character_exclusions`` are the note cells of the currently selected
    character (shown with that character's ``selected_symbol``).
    """
    placements = placements or {}
    cell_px = _cell_size(case.size)
    image = _get_background(case, geometry).copy()
    draw = ImageDraw.Draw(image)
    token_font = _load_font(max(20, cell_px // 3))
    small_font = _load_font(max(13, cell_px // 8))

    # Global X marks.
    for cell in global_exclusions:
        x0, y0, x1, y1 = _cell_box(cell, cell_px)
        pad = cell_px // 4
        draw.line([(x0 + pad, y0 + pad), (x1 - pad, y1 - pad)], fill=_X_COLOR, width=5)
        draw.line([(x0 + pad, y1 - pad), (x1 - pad, y0 + pad)], fill=_X_COLOR, width=5)

    # Selected character's note cells: the symbol, small and struck through,
    # in the top-right corner.
    for cell in character_exclusions:
        x0, y0, x1, y1 = _cell_box(cell, cell_px)
        cx, cy = x1 - 16, y0 + 16
        draw.ellipse((cx - 12, cy - 12, cx + 12, cy + 12),
                     outline=_NOTE_COLOR, width=2)
        _text_center(draw, (cx, cy), (selected_symbol or "?")[:2], small_font,
                     _NOTE_COLOR)
        draw.line([(cx - 10, cy + 10), (cx + 10, cy - 10)], fill=_NOTE_COLOR, width=2)

    # Character tokens.
    characters = case.characters_by_id
    for char_id, cell in placements.items():
        character = characters.get(char_id)
        if character is None:
            continue
        x0, y0, x1, y1 = _cell_box(cell, cell_px)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        radius = cell_px // 2 - 12
        is_victim = char_id == case.victim_id
        fill = _VICTIM_FILL if is_victim else _SUSPECT_FILL
        text_color = _VICTIM_TEXT if is_victim else _TEXT_DARK
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius),
                     fill=fill, outline=_SUSPECT_RING, width=3)
        if is_victim:
            # A second ring makes the victim distinct even in grayscale.
            inner = radius - 5
            draw.ellipse((cx - inner, cy - inner, cx + inner, cy + inner),
                         outline=_VICTIM_TEXT, width=2)
        _text_center(draw, (cx, cy), character.symbol[:2], token_font, text_color)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG", optimize=True)
    return buffer.getvalue()
