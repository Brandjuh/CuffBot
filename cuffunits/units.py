"""Unit detection and conversion — pure, no discord.py.

The hard part of an auto-converting bot is not the arithmetic, it is not
firing on "see you at 10 in the morning", "brb 5 m" or "I'll take the 5 g
plan". Single-letter units are where that goes wrong, so aliases come in two
strengths:

* **loose** — unambiguous enough to allow a space: ``mph``, ``km/h``, ``kg``,
  ``gallons``, ``°F``, ``fahrenheit``.
* **attached** — only recognised when glued to the number: ``5l``, ``72f``,
  ``10mi``. "5 l" is skipped; "5l" is meant.

Units that cannot be made safe at all are simply absent: bare ``m`` (minutes),
bare ``g`` (grams? g-force?) and bare ``in`` ("10 in the morning") are not
recognised — the full word is required instead. The one composite that IS
distinctive enough to keep is US height, ``6'2"``.

Conversions are affine (``base = value * factor + offset``) so temperature uses
the same code path as everything else.
"""

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence, Tuple

#: US liquid gallon. The imperial gallon (4.54609 L) is a guild setting — a
#: 20 % difference is not a rounding detail worth guessing at.
US_GALLON_L = 3.785411784
IMPERIAL_GALLON_L = 4.54609


@dataclass(frozen=True)
class Unit:
    key: str
    family: str
    symbol: str                       # how it renders in output
    factor: float                     # value -> base
    offset: float = 0.0
    loose: Tuple[str, ...] = ()       # aliases that may be separated by a space
    attached: Tuple[str, ...] = ()    # aliases that must touch the number
    counterpart: str = ""             # unit key to convert into

    def to_base(self, value: float) -> float:
        return value * self.factor + self.offset

    def from_base(self, base: float) -> float:
        return (base - self.offset) / self.factor


# Families and their emoji, in the order they appear in the embed.
FAMILY_EMOJI = {
    "temperature": "🌡️",
    "speed": "🚗",
    "volume": "⛽",
    "distance": "📏",
    "mass": "⚖️",
}
FAMILIES = tuple(FAMILY_EMOJI)

_UNITS: Tuple[Unit, ...] = (
    # ── temperature (base: Celsius) ─────────────────────────────────────
    Unit(
        "fahrenheit", "temperature", "°F", 5 / 9, -160 / 9,
        loose=(
            r"°\s*f", "℉", "fahrenheit",
            r"deg(?:rees)?\.?\s*f(?:ahrenheit)?",
            r"graden\s*f(?:ahrenheit)?",
        ),
        attached=("f",),
        counterpart="celsius",
    ),
    Unit(
        "celsius", "temperature", "°C", 1.0, 0.0,
        loose=(
            r"°\s*c", "℃", "celsius", "centigrade",
            r"deg(?:rees)?\.?\s*c(?:elsius)?",
            r"graden\s*c(?:elsius)?",
            # Bare "graden": in Dutch chat "het is 22 graden" is a temperature
            # essentially always. It does mean an angle in "een hoek van 90
            # graden" — accepted as the cheaper mistake, since the weather is
            # what this cog exists for. Delete this line to be strict again.
            "graden",
        ),
        attached=("c",),
        counterpart="fahrenheit",
    ),
    # ── speed (base: km/h) ──────────────────────────────────────────────
    Unit(
        "mph", "speed", "mph", 1.609344,
        loose=("mph", r"mi/h(?:r)?", r"miles?\s*(?:per|/)\s*h(?:our|r)?"),
        counterpart="kph",
    ),
    Unit(
        # Dutch writes km/u ("per uur"), not km/h — and half this precinct is
        # Dutch, so leaving it out made the cog look broken to exactly the
        # people it was built for.
        "kph", "speed", "km/h", 1.0,
        loose=(
            r"km/h(?:r)?", "kmh", "kph",
            r"km/u", "kmu",
            r"kilomet(?:er|re)s?\s*(?:per|/)\s*(?:hour|hr|uur|u)\b",
        ),
        counterpart="mph",
    ),
    # ── volume (base: litre) ────────────────────────────────────────────
    Unit(
        "gallon", "volume", "gal", US_GALLON_L,
        loose=("gallons?", "gals?"),
        counterpart="litre",
    ),
    Unit(
        "quart", "volume", "qt", US_GALLON_L / 4,
        loose=("quarts?", "qts?"),
        counterpart="litre",
    ),
    Unit(
        "pint", "volume", "pt", 0.473176473,
        loose=("pints?",),
        counterpart="litre",
    ),
    Unit(
        "floz", "volume", "fl oz", 0.0295735295625,
        loose=(r"fl\.?\s?oz", "fluid ounces?"),
        counterpart="millilitre",
    ),
    Unit(
        "litre", "volume", "L", 1.0,
        loose=("lit(?:er|re)s?",),
        attached=("l",),
        counterpart="gallon",
    ),
    Unit(
        "millilitre", "volume", "mL", 0.001,
        loose=("ml", r"millilit(?:er|re)s?"),
        counterpart="floz",
    ),
    # ── distance (base: metre) ──────────────────────────────────────────
    Unit(
        "mile", "distance", "mi", 1609.344,
        loose=("miles?",),
        attached=("mi",),
        counterpart="kilometre",
    ),
    Unit(
        "yard", "distance", "yd", 0.9144,
        loose=("yards?", "yds?"),
        counterpart="metre",
    ),
    Unit(
        "foot", "distance", "ft", 0.3048,
        loose=("feet", "foot", "ft"),
        counterpart="metre",
    ),
    Unit(
        "inch", "distance", "in", 0.0254,
        loose=("inch(?:es)?",),  # bare "in" is NOT an alias: "10 in the morning"
        counterpart="centimetre",
    ),
    Unit(
        "kilometre", "distance", "km", 1000.0,
        loose=("km", r"kilomet(?:er|re)s?"),
        counterpart="mile",
    ),
    Unit(
        "metre", "distance", "m", 1.0,
        loose=(r"met(?:er|re)s?",),  # bare "m" is NOT an alias: "brb 5 m"
        counterpart="foot",
    ),
    Unit(
        "centimetre", "distance", "cm", 0.01,
        loose=("cm", r"centimet(?:er|re)s?"),
        counterpart="inch",
    ),
    # ── mass (base: kilogram) ───────────────────────────────────────────
    Unit(
        "pound", "mass", "lb", 0.45359237,
        loose=("lbs?", "pounds?"),
        counterpart="kilogram",
    ),
    Unit(
        "ounce", "mass", "oz", 0.028349523125,
        loose=("oz", "ounces?"),
        counterpart="gram",
    ),
    Unit(
        "stone", "mass", "st", 6.35029318,
        loose=("stones?",),
        counterpart="kilogram",
    ),
    Unit(
        "kilogram", "mass", "kg", 1.0,
        loose=("kg", "kilos?", "kilograms?"),
        counterpart="pound",
    ),
    Unit(
        "gram", "mass", "g", 0.001,
        loose=("grams?",),  # bare "g" is NOT an alias
        counterpart="ounce",
    ),
)

UNITS: Dict[str, Unit] = {unit.key: unit for unit in _UNITS}

#: A number, optionally with thousands separators and decimals. Negatives are
#: allowed for temperature ("-40C" is the fun one).
_NUMBER = r"-?\d{1,3}(?:,\d{3})+(?:\.\d+)?|-?\d+(?:\.\d+)?"


def _build_pattern() -> re.Pattern:
    """One alternation over every alias, longest first.

    Longest-first matters: without it ``km`` would win over ``km/h`` and every
    speed would be read as a distance.
    """
    entries: List[Tuple[str, str, bool]] = []
    for unit in _UNITS:
        for alias in unit.loose:
            entries.append((alias, unit.key, False))
        for alias in unit.attached:
            entries.append((alias, unit.key, True))
    entries.sort(key=lambda item: len(item[0]), reverse=True)

    parts = []
    for index, (alias, _key, _attached) in enumerate(entries):
        parts.append(f"(?P<u{index}>{alias})")
    alternation = "|".join(parts)
    _build_pattern.entries = entries  # type: ignore[attr-defined]
    return re.compile(
        rf"(?<![\w.])(?P<num>{_NUMBER})(?P<gap>\s*)(?:{alternation})(?![a-z0-9])",
        re.IGNORECASE,
    )


PATTERN = _build_pattern()
_ENTRIES: List[Tuple[str, str, bool]] = _build_pattern.entries  # type: ignore[attr-defined]

#: US height, the one composite distinctive enough to be safe. Bare ' and "
#: are never aliases on their own — far too many apostrophes in chat.
HEIGHT_PATTERN = re.compile(r"(?<![\w.])(\d{1,2})'\s?(\d{1,2})\"(?![\w])")

#: Things to strip before scanning, so nothing fires inside a code block, an
#: inline snippet, a URL, a custom emoji or a mention.
_STRIP = re.compile(
    r"```.*?```|`[^`]*`|https?://\S+|<a?:\w+:\d+>|<[@#&!]{1,2}\d+>|<t:\d+(?::[a-zA-Z])?>",
    re.DOTALL,
)


def strip_noise(text: str) -> str:
    """Blank out regions that must never produce a conversion.

    Replaced with spaces rather than removed, so nothing accidentally joins up
    across the gap.
    """
    return _STRIP.sub(lambda m: " " * len(m.group(0)), text or "")


@dataclass
class Match:
    value: float
    unit: Unit
    raw: str


def find_units(text: str, families: Optional[Sequence[str]] = None) -> List[Match]:
    """Every quantity in the text that we are confident about.

    ``families`` limits which unit families are recognised at all.
    """
    allowed = set(families) if families is not None else set(FAMILIES)
    found: List[Match] = []
    cleaned = strip_noise(text)

    for match in HEIGHT_PATTERN.finditer(cleaned):
        if "distance" not in allowed:
            continue
        feet, inches = int(match.group(1)), int(match.group(2))
        if inches >= 12:
            continue
        total_inches = feet * 12 + inches
        found.append(Match(total_inches, UNITS["inch"], match.group(0)))

    for match in PATTERN.finditer(cleaned):
        index = next(
            (int(name[1:]) for name, value in match.groupdict().items()
             if name.startswith("u") and value is not None),
            None,
        )
        if index is None:
            continue
        _alias, key, attached_only = _ENTRIES[index]
        # "5 l" is a typo waiting to happen; "5l" is a litre.
        if attached_only and match.group("gap"):
            continue
        unit = UNITS[key]
        if unit.family not in allowed:
            continue
        try:
            value = float(match.group("num").replace(",", ""))
        except ValueError:
            continue
        found.append(Match(value, unit, match.group(0)))
    return found


def convert(match: Match, *, gallon_litres: float = US_GALLON_L) -> Tuple[float, Unit]:
    """The quantity expressed in its counterpart unit."""
    source, target = match.unit, UNITS[match.unit.counterpart]
    source_factor = _gallon_adjusted(source, gallon_litres)
    target_factor = _gallon_adjusted(target, gallon_litres)
    base = match.value * source_factor + source.offset
    return ((base - target.offset) / target_factor), target


def _gallon_adjusted(unit: Unit, gallon_litres: float) -> float:
    """Gallon and quart follow the guild's US/imperial choice."""
    if unit.key == "gallon":
        return gallon_litres
    if unit.key == "quart":
        return gallon_litres / 4
    return unit.factor


def format_number(value: float) -> str:
    """Readable precision: more decimals for small numbers, none for big ones."""
    magnitude = abs(value)
    if magnitude >= 100:
        text = f"{value:,.1f}"
    elif magnitude >= 1:
        text = f"{value:,.2f}"
    else:
        text = f"{value:,.3f}"
    if "." in text:
        text = text.rstrip("0").rstrip(".")
    return text or "0"


def already_stated(
    present: Sequence[Tuple[str, float]],
    target_key: str,
    target_value: float,
    *,
    tolerance: float = 0.02,
    floor: float = 1.0,
) -> bool:
    """Has the author already given this figure themselves?

    Someone who wrote "72F (22C)" has done the work; answering them is noise.
    Matching on the VALUE rather than on the unit name is what makes this work
    — "22C" never contains the word "celsius", and a name-based check missed it
    entirely. Two unrelated quantities ("limit is 100 km/h but I did 60 mph")
    are far enough apart to still get an answer.
    """
    for key, value in present:
        if key != target_key:
            continue
        if abs(value - target_value) <= max(floor, abs(target_value) * tolerance):
            return True
    return False


def build_conversions(
    text: str,
    *,
    families: Optional[Sequence[str]] = None,
    gallon_litres: float = US_GALLON_L,
    limit: int = 4,
    skip_if_present: bool = True,
) -> List[Dict[str, object]]:
    """The finished conversion rows for one message.

    Duplicates collapse (someone writing "70F 70F" gets one line) and the list
    is capped, because a message full of numbers must not produce a wall.
    """
    matches = find_units(text, families)
    present = [(match.unit.key, match.value) for match in matches]
    rows: List[Dict[str, object]] = []
    seen = set()
    for match in matches:
        target_value, target = convert(match, gallon_litres=gallon_litres)
        if skip_if_present and already_stated(present, target.key, target_value):
            continue
        signature = (match.unit.key, round(match.value, 6))
        if signature in seen:
            continue
        seen.add(signature)
        rows.append(
            {
                "family": match.unit.family,
                "emoji": FAMILY_EMOJI.get(match.unit.family, "📐"),
                "from": f"{format_number(match.value)} {match.unit.symbol}",
                "to": f"{format_number(target_value)} {target.symbol}",
            }
        )
        if len(rows) >= limit:
            break
    return rows
