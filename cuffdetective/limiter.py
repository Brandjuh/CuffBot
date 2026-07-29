"""Process-global AI rate limiter — port of the Node detective lib/limits.js.

One limiter for the whole precinct (deliberately RAM-only: a restart is
briefly more generous). Checks run in a fixed order; each refusal carries a
machine reason and a retry-after in ms.
"""

import math
import time
from typing import Optional

HOUR_MS = 3_600_000
DAY_MS = 86_400_000

DEFAULT_LIMITS = {"min_interval_ms": 7_000, "max_per_hour": 62}


def estimate_tokens(text: str) -> int:
    return math.ceil(len(text) / 4)


def human_wait(ms: float) -> str:
    seconds = math.ceil(ms / 1000)
    if seconds < 60:
        return f"{seconds}s"
    return f"{math.ceil(seconds / 60)}m"


class Verdict:
    __slots__ = ("ok", "reason", "retry_after_ms")

    def __init__(self, ok: bool, reason: Optional[str] = None, retry_after_ms: float = 0):
        self.ok = ok
        self.reason = reason
        self.retry_after_ms = retry_after_ms


class RateLimiter:
    def __init__(
        self,
        min_interval_ms: int = DEFAULT_LIMITS["min_interval_ms"],
        max_per_hour: int = DEFAULT_LIMITS["max_per_hour"],
    ):
        self.min_interval_ms = min_interval_ms
        self.max_per_hour = max_per_hour
        self.stamps: list[dict] = []  # {"t": ms, "tok": tokens}, pruned to 24h

    def _prune(self, now: float):
        cutoff = now - DAY_MS
        self.stamps = [s for s in self.stamps if s["t"] > cutoff]

    def take(
        self,
        now: Optional[float] = None,
        *,
        max_per_day: Optional[int] = None,
        tokens: int = 0,
        tpm: Optional[int] = None,
        tpd: Optional[int] = None,
    ) -> Verdict:
        now = now if now is not None else time.time() * 1000
        self._prune(now)

        if self.stamps and now - self.stamps[-1]["t"] < self.min_interval_ms:
            return Verdict(
                False, "cooldown", self.min_interval_ms - (now - self.stamps[-1]["t"])
            )

        hour = [s for s in self.stamps if s["t"] > now - HOUR_MS]
        if len(hour) >= self.max_per_hour:
            return Verdict(False, "hourly", hour[0]["t"] + HOUR_MS - now)

        if max_per_day is not None and len(self.stamps) >= max_per_day:
            return Verdict(False, "daily", self.stamps[0]["t"] + DAY_MS - now)

        if tpm is not None:
            minute = [s for s in self.stamps if s["t"] > now - 60_000]
            if sum(s["tok"] for s in minute) + tokens > tpm:
                retry = max(1000, minute[0]["t"] + 60_000 - now) if minute else 1000
                return Verdict(False, "tokens-minute", retry)

        if tpd is not None:
            if sum(s["tok"] for s in self.stamps) + tokens > tpd:
                retry = max(1000, self.stamps[0]["t"] + DAY_MS - now) if self.stamps else 1000
                return Verdict(False, "tokens-day", retry)

        self.stamps.append({"t": now, "tok": tokens})
        return Verdict(True)

    def used_last_hour(self, now: Optional[float] = None) -> int:
        now = now if now is not None else time.time() * 1000
        return len([s for s in self.stamps if s["t"] > now - HOUR_MS])

    def used_last_day(self, now: Optional[float] = None) -> int:
        now = now if now is not None else time.time() * 1000
        self._prune(now)
        return len(self.stamps)
