"""Hammertime timezone lookup: a name, a city, an abbreviation or an offset.

Ported from ``src/modules/hammertime/lib/zones.js``, with the Node port's one
recorded regression repaired. That version built its index on ``Intl``, which
only exposes a zone's abbreviation *right now* — so in July "EST" did not find
America/New_York (that zone reads EDT in summer), and in January "EDT" found
nothing. The original pytz-based cog indexed both because pytz carried the
transition table.

Back in Python the tz database is available again, so each zone is sampled in
BOTH January and July and both abbreviations are indexed. `est` finds New York
year-round, and so does `edt`.
"""

from datetime import datetime
from typing import Dict, List, Optional, Set, Tuple
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

import re

from .timelib import is_valid_timezone

_cache: Optional[Tuple[Dict[str, Set[str]], Dict[str, int]]] = None

RE_OFFSET = re.compile(r"^(?:utc|gmt)?\s*([+-])?\s*(\d{1,2})(?::?(\d{2}))?$")

#: What a person MEANS by these, resolved straight to one zone with no picker.
#:
#: "EST" is technically the current abbreviation of 35 zones — Cancún, Jamaica,
#: Panama, Atikokan… — and "CST" of 44. Handing an American that list, sorted
#: alphabetically so it opens on America/Bahia_Banderas, is useless: they know
#: they are on Eastern Time, not which IANA city represents it. These are the
#: names people actually type, mapped to the zone they actually mean.
#:
#: The canonical zone is the one whose DST rules match the name. Cancún is on
#: EST year-round, so it is NOT a valid answer for someone who says "EST" and
#: expects their clock to spring forward — that is exactly the mistake this
#: table prevents.
CANONICAL_ALIASES: Dict[str, str] = {
    # United States — the four continental zones plus the outliers.
    "est": "America/New_York",
    "edt": "America/New_York",
    "et": "America/New_York",
    "eastern": "America/New_York",
    "eastern time": "America/New_York",
    "cst": "America/Chicago",
    "cdt": "America/Chicago",
    "ct": "America/Chicago",
    "central": "America/Chicago",
    "central time": "America/Chicago",
    "mst": "America/Denver",
    "mdt": "America/Denver",
    "mt": "America/Denver",
    "mountain": "America/Denver",
    "mountain time": "America/Denver",
    "pst": "America/Los_Angeles",
    "pdt": "America/Los_Angeles",
    "pt": "America/Los_Angeles",
    "pacific": "America/Los_Angeles",
    "pacific time": "America/Los_Angeles",
    "akst": "America/Anchorage",
    "akdt": "America/Anchorage",
    "alaska": "America/Anchorage",
    "hst": "Pacific/Honolulu",
    "hawaii": "Pacific/Honolulu",
    # Arizona keeps Mountain STANDARD time all year — a real, separate answer.
    "arizona": "America/Phoenix",
    "az": "America/Phoenix",
    # United Kingdom, the other one people type as an abbreviation.
    "gmt": "Europe/London",
    "bst": "Europe/London",
    "uk": "Europe/London",
    "britain": "Europe/London",
}

#: How the canonical zones read to a human, for the confirmation message.
FRIENDLY_NAMES: Dict[str, str] = {
    "America/New_York": "US Eastern Time",
    "America/Chicago": "US Central Time",
    "America/Denver": "US Mountain Time",
    "America/Phoenix": "Arizona (no daylight saving)",
    "America/Los_Angeles": "US Pacific Time",
    "America/Anchorage": "Alaska Time",
    "Pacific/Honolulu": "Hawaii Time",
    "Europe/London": "UK Time",
    "Europe/Amsterdam": "Netherlands Time",
}

#: Shown first in a picker — the zones this precinct actually lives in.
PRIORITY_ZONES = [
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Phoenix",
    "America/Los_Angeles",
    "America/Anchorage",
    "Pacific/Honolulu",
    "Europe/Amsterdam",
    "Europe/London",
]


def friendly_name(zone: str) -> Optional[str]:
    """The human name for a zone, when it has one."""
    return FRIENDLY_NAMES.get(zone)


def describe_zone(zone: str, now_ms: Optional[int] = None) -> str:
    """"EDT · UTC−04:00 · 4:19 PM" — what a picker row says under the name.

    The local time is the point: someone who cannot tell America/New_York from
    America/Detroit can always recognise the row showing the clock they are
    looking at.
    """
    stamp = (datetime.now().timestamp()) if now_ms is None else (now_ms / 1000)
    try:
        moment = datetime.fromtimestamp(stamp, tz=ZoneInfo(zone))
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return zone
    offset = moment.utcoffset()
    minutes = int(offset.total_seconds() // 60) if offset else 0
    sign = "−" if minutes < 0 else "+"
    hours, mins = divmod(abs(minutes), 60)
    hour12 = moment.hour % 12 or 12
    clock = f"{hour12}:{moment.minute:02d} {'AM' if moment.hour < 12 else 'PM'}"
    parts = [moment.tzname() or "", f"UTC{sign}{hours:02d}:{mins:02d}", clock]
    return " · ".join(part for part in parts if part)


def sort_for_picker(zones: List[str]) -> List[str]:
    """Priority zones first, then alphabetical — so a picker opens on the
    answer most of this server wants instead of on Bahia Banderas."""
    priority = [zone for zone in PRIORITY_ZONES if zone in zones]
    rest = sorted(zone for zone in zones if zone not in priority)
    return priority + rest


def _abbreviations(zone: str, year: int) -> Set[str]:
    """The zone's short names across the year — standard AND daylight.

    Sampling mid-January and mid-July catches both sides of a DST rule in
    either hemisphere. Purely numeric names ("+03") are indexed too: they are
    what some zones actually report, and a user may well type them.
    """
    names: Set[str] = set()
    for month in (1, 7):
        try:
            name = datetime(year, month, 15, 12, tzinfo=ZoneInfo(zone)).tzname()
        except (ZoneInfoNotFoundError, ValueError, KeyError, OverflowError):
            continue
        if name:
            names.add(name)
    return names


def build_timezone_map(now_ms: Optional[int] = None, *, rebuild: bool = False):
    """zone → lookup keys, built once (~600 zones, a few hundred ms on a Pi).

    Offsets are sampled at ``now_ms`` — fine for *finding* a zone; conversions
    always run against the real zone rules afterwards.
    """
    global _cache
    if _cache is not None and not rebuild:
        return _cache

    moment = datetime.now() if now_ms is None else datetime.fromtimestamp(now_ms / 1000)
    year = moment.year
    stamp = moment.timestamp()

    index: Dict[str, Set[str]] = {}
    offsets: Dict[str, int] = {}

    def add(key: str, zone: str) -> None:
        index.setdefault(key.lower(), set()).add(zone)

    for zone in available_timezones():
        add(zone, zone)
        # Every segment after the first: "America/Indiana/Knox" is findable as
        # "indiana" and as "knox".
        for segment in zone.lower().split("/")[1:]:
            add(segment, zone)
            if "_" in segment:
                add(segment.replace("_", " "), zone)
        for short in _abbreviations(zone, year):
            add(short, zone)
        try:
            offset = datetime.fromtimestamp(stamp, tz=ZoneInfo(zone)).utcoffset()
            offsets[zone] = int(offset.total_seconds() // 60) if offset else 0
        except (ZoneInfoNotFoundError, ValueError, KeyError):
            continue

    _cache = (index, offsets)
    return _cache


def lookup_timezones(query: str, now_ms: Optional[int] = None) -> List[str]:
    """Every zone matching a user query — a name, a city, an abbreviation or a
    numeric offset. Sorted; an empty list means "not a valid timezone"."""
    index, offsets = build_timezone_map(now_ms)
    trimmed = str(query or "").strip()
    # What people MEAN wins over what the abbreviation technically matches:
    # "est" is one answer, not thirty-five.
    canonical = CANONICAL_ALIASES.get(" ".join(trimmed.lower().replace("_", " ").split()))
    if canonical:
        return [canonical]
    lowered = trimmed.lower().replace(" ", "_")
    if lowered in index:
        return sorted(index[lowered])
    # Spaces kept, for the "new york" spelling indexed above.
    spaced = trimmed.lower()
    if spaced in index:
        return sorted(index[spaced])
    # Aliases the tz database accepts but available_timezones() may omit
    # (US/Eastern, Etc/GMT-2…).
    if re.search(r"[a-z]", trimmed, re.IGNORECASE) and is_valid_timezone(trimmed):
        return [trimmed]

    match = RE_OFFSET.match(trimmed.lower())
    if match:
        sign = -1 if match.group(1) == "-" else 1
        minutes = sign * (int(match.group(2)) * 60 + int(match.group(3) or 0))
        return sorted(zone for zone, offset in offsets.items() if offset == minutes)
    return []
