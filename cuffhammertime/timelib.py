"""Hammertime time math — zone-aware wall-clock conversions and the cog's
display format.

Ported from the CuffBot Node module ``src/modules/hammertime/lib/time.js``,
which was itself a port of Dumb-Cogs/hammertime. The Node version had to
rebuild all of this on ``Intl`` because JavaScript has no tz database; back in
Python it is ``zoneinfo`` again, so the iterative wall-clock inverse the Node
port needed collapses into ordinary aware-datetime arithmetic.

No discord.py here. Every function takes an explicit instant — nothing reads
the clock on its own, so the whole layer is testable with fixed timestamps.
"""

from datetime import datetime, timedelta, timezone as dt_timezone
from typing import Optional
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]
MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def is_valid_timezone(name: object) -> bool:
    """Is this a zone name the tz database knows?"""
    if not isinstance(name, str) or not name.strip():
        return False
    try:
        ZoneInfo(name)
        return True
    except (ZoneInfoNotFoundError, ValueError, KeyError):
        return False


def zoned(epoch_ms: int, tz_name: str) -> datetime:
    """The aware datetime whose wall clock is ``tz_name``'s at that instant."""
    return datetime.fromtimestamp(epoch_ms / 1000, tz=ZoneInfo(tz_name))


def to_epoch_ms(moment: datetime, tz_name: str) -> int:
    """The instant whose wall clock in ``tz_name`` reads ``moment``.

    ``moment`` is treated as a NAIVE wall time (any tzinfo on it is dropped).
    A wall time that DST skipped resolves to a nearby valid instant, which is
    the lenient behaviour the original cog relied on from dateutil.
    """
    naive = moment.replace(tzinfo=None)
    return int(naive.replace(tzinfo=ZoneInfo(tz_name)).timestamp() * 1000)


def offset_minutes_at(epoch_ms: int, tz_name: str) -> int:
    """The zone's UTC offset in minutes at that instant (east positive)."""
    offset = zoned(epoch_ms, tz_name).utcoffset()
    return int(offset.total_seconds() // 60) if offset is not None else 0


def add_months(moment: datetime, months: int) -> datetime:
    """The cog's ``add_months``: calendar-safe — the day clamps to the target
    month's length, so Jan 31 + 1 month is Feb 28 (or 29), never Mar 3."""
    zero_based = moment.month - 1 + months
    year = moment.year + zero_based // 12
    month = zero_based % 12 + 1
    day = min(moment.day, days_in_month(year, month))
    return moment.replace(year=year, month=month, day=day)


def days_in_month(year: int, month: int) -> int:
    if month == 12:
        following = datetime(year + 1, 1, 1)
    else:
        following = datetime(year, month + 1, 1)
    return (following - timedelta(days=1)).day


def add_wall(moment: datetime, delta: timedelta) -> datetime:
    """Wall-clock addition: the WALL time moves by the delta and the offset
    renormalises afterwards, matching the cog's aware ``+ timedelta``.

    "in 1 day" therefore means the same clock time tomorrow even across a DST
    switch — 23 or 25 real hours, not 24.
    """
    return moment.replace(tzinfo=None) + delta


def th(number: int) -> str:
    """The cog's ordinal suffix."""
    if 4 <= number % 100 <= 20:
        return "th"
    return {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")


def format_users_time(epoch_ms: int, tz_name: str) -> str:
    """The cog's ``DT_FMT`` — "Saturday, Jul 25th at 6:30 PM".

    Hand-rolled rather than ``strftime``: ``%-d``/``%-I`` are glibc-only and
    the weekday/month names must not follow the host locale.
    """
    moment = zoned(epoch_ms, tz_name)
    hour12 = moment.hour % 12 or 12
    ampm = "AM" if moment.hour < 12 else "PM"
    weekday = WEEKDAYS_LONG[(moment.weekday() + 1) % 7]  # Python: Monday=0
    return (
        f"{weekday}, {MONTHS_SHORT[moment.month - 1]} {moment.day}{th(moment.day)} "
        f"at {hour12}:{moment.minute:02d} {ampm}"
    )


def now_ms(clock: Optional[datetime] = None) -> int:
    moment = clock or datetime.now(dt_timezone.utc)
    return int(moment.timestamp() * 1000)
