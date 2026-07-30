"""Hammertime phrase parsing: "in 1 day and 12 hrs", "saturday at 6:30pm".

Ported from ``src/modules/hammertime/lib/parse.js`` (itself a port of
Dumb-Cogs/hammertime). The relative regex is the cog's, verbatim; deltas apply
cumulatively in wall-clock terms; the absolute parser is the simplified fuzzy
reader the Node port built to replace dateutil's ``fuzzy=True``.

Recorded deviation, carried over from the Node port: a phrase with no
recognisable date or time returns ``None`` ("I couldn't understand that")
where the original cog's fuzzy parse silently answered *today at 00:00*.

Every function takes an explicit ``now_ms``.
"""

import re
from datetime import datetime, timedelta
from typing import Dict, Optional, Tuple

from .timelib import (
    MONTHS,
    WEEKDAYS,
    add_months,
    add_wall,
    to_epoch_ms,
    zoned,
)

# The cog's RE_RELATIVE_TIME, ported: "1 hour", "an hour ago", "2 wks"…
RE_RELATIVE_TIME = re.compile(
    r"(\d+|an?)\s?(y(?:ea)?rs?|months?|weeks?|days?|h(?:ou)?rs?|min(?:ute)?s?|sec(?:ond)?s?)( ago)?"
)
# The cog's auto-mode gates.
RE_AT_IN = re.compile(r"(\s|^)(at|in)\s\d")
RE_AT = re.compile(r"(\s|^)at\s(\d{1,2}:?\d{0,2})\s?(am|pm)?(?=\W|$)")

UNIT_DELTA = {
    "weeks": timedelta(weeks=1),
    "days": timedelta(days=1),
    "hours": timedelta(hours=1),
    "minutes": timedelta(minutes=1),
    "seconds": timedelta(seconds=1),
}

RE_TIME_TOKEN = re.compile(r"^(\d{1,2})(?::(\d{2}))?(am|pm)?$")
RE_NUMERIC_DATE = re.compile(r"^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$")
RE_ISO_DATE = re.compile(r"^(\d{4})-(\d{1,2})-(\d{1,2})$")
RE_DAY_NUMBER = re.compile(r"^(\d{1,2})(?:st|nd|rd|th)?$")

MONTH_INDEX: Dict[str, int] = {}
for _i, _name in enumerate(MONTHS):
    MONTH_INDEX[_name] = _i + 1
    MONTH_INDEX[_name[:3]] = _i + 1

WEEKDAY_INDEX: Dict[str, int] = {}
for _i, _name in enumerate(WEEKDAYS):
    WEEKDAY_INDEX[_name] = _i
    WEEKDAY_INDEX[_name[:3]] = _i


def _unit_of(period: str) -> str:
    if period.startswith("month"):
        return "months"
    return {"y": "years", "w": "weeks", "d": "days", "h": "hours", "m": "minutes", "s": "seconds"}[
        period[0]
    ]


def parse_delta(text: str, tz_name: str, now_ms: int) -> Optional[int]:
    """The cog's ``parse_delta``.

    ``now`` (the word, but not "not now") is the current instant; otherwise
    every relative match applies cumulatively IN ORDER with wall-clock
    semantics — months and years through the calendar-safe month arithmetic,
    everything else as plain time on the wall clock.
    """
    lower = str(text or "").lower().strip()
    if "not now" not in lower and "now" in lower.split():
        return now_ms

    matches = list(RE_RELATIVE_TIME.finditer(lower))
    if not matches:
        return None

    moment = zoned(now_ms, tz_name).replace(tzinfo=None)
    for match in matches:
        amount_raw, period, past = match.group(1), match.group(2), match.group(3)
        amount = int(amount_raw) if amount_raw.isdigit() else 1  # 'a'/'an' = 1
        if past == " ago":
            amount = -amount
        unit = _unit_of(period)
        if unit in ("months", "years"):
            moment = add_months(moment, amount * (12 if unit == "years" else 1))
        else:
            moment = add_wall(moment, amount * UNIT_DELTA[unit])
    return to_epoch_ms(moment, tz_name)


def parse_absolute(text: str, tz_name: str, now_ms: int) -> Optional[int]:
    """The cog's ``parse_datetime``, hand-rolled.

    Understands today/tomorrow/yesterday, a weekday name (next occurrence,
    today included), "jan 5" / "5 jan" / "jan 5th", numeric M/D[/Y] in US
    order, ISO Y-M-D, and a clock time H[:MM][am|pm] — a bare trailing number
    reads as the hour. Unknown words are skipped, a missing time is midnight.
    """
    today = zoned(now_ms, tz_name).replace(tzinfo=None)
    tokens = [token for token in str(text or "").lower().replace(",", " ").split() if token]

    date: Optional[Tuple[int, int, int]] = None  # (year, month, day)
    time: Optional[Dict[str, int]] = None
    from_bare = False
    ampm: Optional[str] = None
    saw_date_word = False
    pending_month: Optional[int] = None
    bare_number: Optional[int] = None

    def day_from_today(offset: int) -> Tuple[int, int, int]:
        moved = today.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=offset)
        return (moved.year, moved.month, moved.day)

    for token in tokens:
        if token in ("today", "tomorrow", "yesterday"):
            date = day_from_today({"today": 0, "tomorrow": 1, "yesterday": -1}[token])
            saw_date_word = True
            continue
        if token in WEEKDAY_INDEX:
            # dateutil's resolution: the next such weekday, today included.
            today_dow = (today.weekday() + 1) % 7  # Python: Monday=0; cog: Sunday=0
            ahead = (WEEKDAY_INDEX[token] - today_dow + 7) % 7
            date = day_from_today(ahead)
            saw_date_word = True
            continue
        if token in MONTH_INDEX:
            pending_month = MONTH_INDEX[token]
            # A number just before the month name was its day ("5 jan").
            if bare_number is not None and 1 <= bare_number <= 31:
                date = (today.year, pending_month, bare_number)
                saw_date_word = True
                pending_month = None
                bare_number = None
                if from_bare:  # that number was a day, not an hour
                    time = None
                    from_bare = False
            continue
        iso = RE_ISO_DATE.match(token)
        if iso:
            date = (int(iso.group(1)), int(iso.group(2)), int(iso.group(3)))
            saw_date_word = True
            continue
        numeric = RE_NUMERIC_DATE.match(token)
        if numeric:
            year = int(numeric.group(3)) if numeric.group(3) else today.year
            if year < 100:
                year += 2000
            date = (year, int(numeric.group(1)), int(numeric.group(2)))
            saw_date_word = True
            continue
        if pending_month is not None:
            day_match = RE_DAY_NUMBER.match(token)
            if day_match:
                # "jan 5" / "jan 5th" — the number after a month name is its day.
                date = (today.year, pending_month, int(day_match.group(1)))
                saw_date_word = True
                pending_month = None
                continue
        clock = RE_TIME_TOKEN.match(token)
        if clock:
            value = int(clock.group(1))
            if clock.group(2) or clock.group(3):
                time = {"hour": value, "minute": int(clock.group(2) or 0)}
                from_bare = False
                ampm = clock.group(3) or ampm
            elif time is None:
                # A bare number reads as the hour ("at 6" → 06:00) — unless a
                # month name later claims it as a day.
                time = {"hour": value, "minute": 0}
                from_bare = True
                bare_number = value
            continue
        if token in ("am", "pm"):
            ampm = token
            continue
        # Anything else (at, on, names…) is skipped — fuzzy dateutil behaviour.

    if not saw_date_word and time is None:
        return None

    hour = time["hour"] if time else 0
    minute = time["minute"] if time else 0
    if time and hour <= 12 and ampm:
        if ampm == "pm" and hour != 12:
            hour += 12
        if ampm == "am" and hour == 12:
            hour = 0
    if hour > 23 or minute > 59:
        return None

    year, month, day = date if date is not None else day_from_today(0)
    try:
        target = datetime(year, month, day, hour, minute)
    except ValueError:
        return None  # e.g. "2/30" — a date that does not exist
    return to_epoch_ms(target, tz_name)


def parse_phrase(text: str, tz_name: str, now_ms: int) -> Optional[Dict[str, object]]:
    """The cog's ``get_datetime_for`` order: relative first, absolute second."""
    delta = parse_delta(text, tz_name, now_ms)
    if delta is not None:
        return {"epoch_ms": delta, "kind": "delta"}
    absolute = parse_absolute(text, tz_name, now_ms)
    if absolute is not None:
        return {"epoch_ms": absolute, "kind": "datetime"}
    return None


def infer_ampm(hour: int, tz_name: str, now_ms: int) -> str:
    """The cog's am/pm inference for a bare "at H": take the CURRENT half of
    the day, flipped when that hour has already passed in it.

    Quirky — at 3:30 PM, "at 2" means 2 AM — and ported as-is.
    """
    if hour > 12:
        return "pm"
    now = zoned(now_ms, tz_name)
    ampm = "am" if now.hour < 12 else "pm"
    now_hour12 = now.hour % 12 or 12
    if hour < now_hour12:
        ampm = "pm" if ampm == "am" else "am"
    return ampm


def parse_auto_message(content: str, tz_name: str, now_ms: int) -> Optional[int]:
    """The cog's ``on_message`` pipeline after the at/in gate.

    Relative parse first; otherwise exactly ONE "at H[:MM]" (two or more and
    it stays silent), am/pm inferred when absent, then the absolute parse.
    """
    lower = str(content or "").lower()
    if not RE_AT_IN.search(lower):
        return None
    delta = parse_delta(lower, tz_name, now_ms)
    if delta is not None:
        return delta

    matches = list(RE_AT.finditer(lower))
    if len(matches) != 1:
        return None
    time_raw, ampm_raw = matches[0].group(2), matches[0].group(3)
    text = lower
    if not ampm_raw:
        head = time_raw.split(":")[0] if ":" in time_raw else time_raw
        text = lower.replace(time_raw, f"{time_raw} {infer_ampm(int(head), tz_name, now_ms)}")
    return parse_absolute(text, tz_name, now_ms)
