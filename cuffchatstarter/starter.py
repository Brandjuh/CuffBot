"""Pure chat-starter rules — port of the Node module's ``lib/starter.js``.

No discord objects and no timers, so every rule below is testable with plain
numbers. Two decisions live here: *when* a quiet channel has earned an
ice-breaker, and *which* question to post.
"""

from __future__ import annotations

import random as _random
from typing import Any, Dict, List, Optional, Sequence, Tuple

#: Owner decision 2026-07-24, carried over from the Node module: the starter
#: runs in this channel after 12 hours of silence. Committed as product
#: defaults so the cog works the moment it is loaded; commands override them.
DEFAULT_CHANNEL_ID = 411609312037961729
DEFAULT_IDLE_MINUTES = 720  # 12 hours of silence

#: Don't repeat any of the last N questions.
RECENT_MEMORY = 10

IDLE_MIN = 15
IDLE_MAX = 1440


def validate_questions(doc: Any) -> Tuple[bool, str]:
    """Check a question-bank document. Returns ``(ok, error)``."""
    if not isinstance(doc, dict):
        return False, "the bank must be a JSON object"
    questions = doc.get("questions")
    if not isinstance(questions, list) or not questions:
        return False, "questions missing or empty"
    if not all(isinstance(q, str) and q.strip() for q in questions):
        return False, "every question must be a non-empty string"
    return True, ""


def should_post(
    *, enabled: bool, channel_id: Optional[int], idle_minutes: int, idle_ms: float,
    human_since_starter: bool,
) -> Tuple[bool, str]:
    """Should the sweep post a starter right now? ``(post, reason)``.

    ``human_since_starter`` is the anti-monologue guard: after one starter, at
    least one human message must appear before the next one is allowed.
    """
    if not enabled:
        return False, "disabled"
    if not channel_id:
        return False, "no-channel"
    if not human_since_starter:
        return False, "no-human-since-last-starter"
    if idle_ms < idle_minutes * 60_000:
        return False, "not-idle-enough"
    return True, ""


def pick_question_index(
    count: int, recent_indexes: Sequence[int] = (), rng: Optional[_random.Random] = None
) -> int:
    """An index into the bank, avoiding the recently used ones.

    The recent window is clamped to ``count - 1`` so it can never exclude the
    entire bank — a 5-question bank with a memory of 10 would otherwise have
    nothing left to choose from.
    """
    if count <= 0:
        raise ValueError("empty question bank")
    rng = rng or _random
    window = min(RECENT_MEMORY, max(0, count - 1))
    recent = set(list(recent_indexes)[-window:]) if window else set()
    candidates = [i for i in range(count) if i not in recent]
    return rng.choice(candidates or list(range(count)))


def remember_index(recent_indexes: Optional[Sequence[int]], index: int) -> List[int]:
    """Track a used index in the recent ring."""
    return [*(recent_indexes or []), index][-RECENT_MEMORY:]


def new_activity(now_ms: float) -> Dict[str, Any]:
    """A fresh activity record: treat now as the last activity, starter allowed."""
    return {"last_activity_at": now_ms, "human_since_starter": True}
