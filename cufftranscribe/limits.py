"""Groq's actual rate limits, and a budget that mirrors them.

Ported from CuffBot's ``src/modules/transcribe/lib/limits.js``. These are
Groq's documented FREE-tier limits for the Whisper models, and the numbers
this module enforces:

    20 requests / minute
    2,000 requests / day
    7,200 audio-seconds / hour   (2 hours of audio per clock hour)
    28,800 audio-seconds / day   (8 hours of audio per day)
    **10 seconds minimum billed per request**

Pure: state in, state out, ``now`` injected (milliseconds since the epoch,
the same unit the Node bot persisted). No storage, no network.
"""

from __future__ import annotations

import math
from datetime import datetime, timezone
from time import time
from typing import Any, Dict, List, Optional

__all__ = (
    "GROQ_FREE_LIMITS",
    "REFUSAL_TEXT",
    "RateLimited",
    "billed_seconds",
    "check_budget",
    "day_key",
    "describe_usage",
    "empty_usage",
    "now_ms",
    "record_spend",
    "release_rate",
    "spend_budget",
)

#: Groq free tier, both Whisper models. Change these only against the docs.
GROQ_FREE_LIMITS: Dict[str, int] = {
    "requests_per_minute": 20,
    "requests_per_day": 2_000,
    "audio_seconds_per_hour": 7_200,
    "audio_seconds_per_day": 28_800,
    # Every request is billed at least this much, however short the audio.
    "min_billed_seconds": 10,
}

#: What to assume when Groq refuses without saying how long to wait.
DEFAULT_RATE_RETRY_MS = 5_000


class RateLimited(RuntimeError):
    """Groq received the request and refused it.

    Worth its own type because of what it means for the local counters: the
    attempt COUNTED against Groq's window even though no transcript came
    back. Handing the claimed slot back — the right thing when a download
    failed and nothing was ever sent — would let us straight back in for
    another rejection, and the two counters would drift apart until every
    request was a 429.
    """

    def __init__(self, message: str, *, retry_after_ms: int = DEFAULT_RATE_RETRY_MS):
        super().__init__(message)
        self.retry_after_ms = int(retry_after_ms)


MINUTE_MS = 60_000
HOUR_MS = 60 * MINUTE_MS
DAY_MS = 24 * HOUR_MS


def now_ms() -> int:
    """Current time in milliseconds — the unit every window below uses."""
    return int(time() * 1000)


def _as_number(value: Any) -> float:
    """Node's ``Number(x) || 0``: anything non-numeric counts as zero."""
    try:
        number = float(value)
    except (TypeError, ValueError):
        return 0.0
    if math.isnan(number) or math.isinf(number):
        return 0.0
    return number


def billed_seconds(seconds: Any, limits: Optional[Dict[str, int]] = None) -> int:
    """What a piece of audio actually costs, after Groq's 10-second floor."""
    lims = limits or GROQ_FREE_LIMITS
    return max(lims["min_billed_seconds"], math.ceil(_as_number(seconds)))


def empty_usage() -> Dict[str, list]:
    return {"requests": [], "audio": []}


def _prune(usage: Optional[dict], now: int) -> Dict[str, list]:
    """Drop entries older than the longest window we care about (a day)."""
    usage = usage or empty_usage()
    day_ago = now - DAY_MS
    return {
        "requests": [t for t in (usage.get("requests") or []) if t > day_ago],
        "audio": [e for e in (usage.get("audio") or []) if e.get("at", 0) > day_ago],
    }


def check_budget(
    usage: Optional[dict],
    seconds: Any,
    *,
    now: Optional[int] = None,
    limits: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """May one more request of ``seconds`` of audio go out right now?

    Returns a **reason and a retry time**, not a boolean: "wait 12s" and
    "the day's audio budget is gone" need different messages.

    Check order: rpm, rpd, audio-hour, audio-day — with ``retry_after_ms``
    computed from the oldest entry in the offending window.
    """
    if now is None:
        now = now_ms()
    lims = limits or GROQ_FREE_LIMITS
    pruned = _prune(usage, now)
    cost = billed_seconds(seconds, lims)

    per_minute = [t for t in pruned["requests"] if t > now - MINUTE_MS]
    if len(per_minute) >= lims["requests_per_minute"]:
        # The oldest request in the window is the one whose expiry frees a slot.
        return {
            "ok": False,
            "reason": "rpm",
            "retry_after_ms": max(0, per_minute[0] + MINUTE_MS - now),
            "cost": cost,
            "usage": pruned,
        }

    per_day = [t for t in pruned["requests"] if t > now - DAY_MS]
    if len(per_day) >= lims["requests_per_day"]:
        return {
            "ok": False,
            "reason": "rpd",
            "retry_after_ms": max(0, per_day[0] + DAY_MS - now),
            "cost": cost,
            "usage": pruned,
        }

    audio_hour = [e for e in pruned["audio"] if e["at"] > now - HOUR_MS]
    used_hour = sum(e["seconds"] for e in audio_hour)
    if used_hour + cost > lims["audio_seconds_per_hour"]:
        oldest = audio_hour[0]["at"] if audio_hour else now
        return {
            "ok": False,
            "reason": "audio-hour",
            "retry_after_ms": max(0, oldest + HOUR_MS - now),
            "cost": cost,
            "usage": pruned,
        }

    used_day = sum(e["seconds"] for e in pruned["audio"])
    if used_day + cost > lims["audio_seconds_per_day"]:
        oldest = pruned["audio"][0]["at"] if pruned["audio"] else now
        return {
            "ok": False,
            "reason": "audio-day",
            "retry_after_ms": max(0, oldest + DAY_MS - now),
            "cost": cost,
            "usage": pruned,
        }

    return {"ok": True, "reason": "ok", "retry_after_ms": 0, "cost": cost, "usage": pruned}


def record_spend(usage: Optional[dict], cost: int, now: Optional[int] = None) -> Dict[str, list]:
    """Record a spend. Call only after ``check_budget`` said yes AND the call went out."""
    if now is None:
        now = now_ms()
    pruned = _prune(usage, now)
    return {
        "requests": [*pruned["requests"], now],
        "audio": [*pruned["audio"], {"at": now, "seconds": cost}],
    }


def release_rate(usage: Optional[dict], cost: int, now: Optional[int] = None) -> Dict[str, list]:
    """Hand capacity back when the request never actually went out.

    Ported from ``service.js`` ``releaseRate``: pop the claimed request, and
    remove the *matching* audio entry rather than the last one blindly, so a
    concurrent spend is not the thing that gets refunded.
    """
    if now is None:
        now = now_ms()
    usage = usage or empty_usage()
    requests: List[int] = list(usage.get("requests") or [])
    audio: List[dict] = list(usage.get("audio") or [])
    if requests:
        requests.pop()
    idx = next(
        (i for i, e in enumerate(audio) if e.get("seconds") == cost and e.get("at", 0) <= now),
        -1,
    )
    if idx >= 0:
        audio.pop(idx)
    elif audio:
        audio.pop()
    return {"requests": requests, "audio": audio}


def describe_usage(
    usage: Optional[dict],
    *,
    now: Optional[int] = None,
    limits: Optional[Dict[str, int]] = None,
) -> Dict[str, Any]:
    """Human-readable state, for the ``transcribe`` status line."""
    if now is None:
        now = now_ms()
    lims = limits or GROQ_FREE_LIMITS
    pruned = _prune(usage, now)
    minute = len([t for t in pruned["requests"] if t > now - MINUTE_MS])
    day = len(pruned["requests"])
    audio_hour = sum(e["seconds"] for e in pruned["audio"] if e["at"] > now - HOUR_MS)
    audio_day = sum(e["seconds"] for e in pruned["audio"])
    return {
        "minute": minute,
        "day": day,
        "audio_hour": audio_hour,
        "audio_day": audio_day,
        "limits": lims,
        # A percentage of the tightest window is what tells you whether you
        # are about to run out, which a raw count does not.
        "tightest": max(
            minute / lims["requests_per_minute"],
            day / lims["requests_per_day"],
            audio_hour / lims["audio_seconds_per_hour"],
            audio_day / lims["audio_seconds_per_day"],
        ),
    }


#: Why a refusal happened, and what to do about it.
REFUSAL_TEXT = {
    "rpm": lambda wait_ms: (
        "⏳ Groq allows 20 requests a minute and we are at the cap — "
        f"retrying in {math.ceil(wait_ms / 1000)}s."
    ),
    "rpd": lambda wait_ms: (
        "🚫 Groq's 2,000 requests for today are used up. It resets on a rolling 24-hour window."
    ),
    "audio-hour": lambda wait_ms: (
        "🚫 Two hours of audio in the last hour — Groq's hourly ceiling. "
        "It frees up as the hour rolls on."
    ),
    "audio-day": lambda wait_ms: "🚫 Eight hours of audio today — Groq's daily ceiling.",
}


def day_key(now: Optional[int] = None) -> str:
    """UTC day stamp — the window the optional daily limit counts against."""
    if now is None:
        now = now_ms()
    return datetime.fromtimestamp(now / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def spend_budget(counter: Optional[dict], limit: int, now: Optional[int] = None):
    """Spend one unit of today's optional per-guild budget.

    Returns ``(counter, allowed)``; rolling over to a new day resets the
    count, so no scheduled job is needed to clear it.
    """
    if now is None:
        now = now_ms()
    today = day_key(now)
    used = 0
    if counter and counter.get("day") == today:
        used = int(_as_number(counter.get("used")))
    if limit > 0 and used >= limit:
        return {"day": today, "used": used}, False
    return {"day": today, "used": used + 1}, True
