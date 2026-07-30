"""Pure rap-sheet logic — port of the Node module's ``lib/api.js`` and
``lib/format.js``. No discord objects, so the formatting rules are testable
with plain dicts.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

RECORD_TYPES = ("citation", "detainment", "arrest", "release")

TYPE_BADGES = {
    "citation": "📋",
    "detainment": "🚔",
    "arrest": "🚨",
    "release": "🔓",
}

#: Discord rejects a message body over 2000 characters outright.
MESSAGE_LIMIT = 1990
DEFAULT_MAX_ENTRIES = 10


def _plural(count: int, word: str) -> str:
    return f"{count} {word}{'' if count == 1 else 's'}"


def format_rap_sheet(
    display_name: str,
    entries: Sequence[Dict[str, Any]],
    *,
    max_entries: int = DEFAULT_MAX_ENTRIES,
) -> str:
    """Render a member's rap sheet as a message body.

    Dates are Discord relative timestamps rather than ``2026-07-14``: the raw
    date told the reader nothing about how long ago it was, and printed in
    whatever timezone the host happened to run in.
    """
    name = str(display_name).upper()
    if not entries:
        return f"🕊️ Clean sheet — no records on file for **{name}**."

    counts: Dict[str, int] = {}
    for entry in entries:
        counts[entry["type"]] = counts.get(entry["type"], 0) + 1
    summary = " · ".join(
        f"{TYPE_BADGES.get(kind, '•')} {_plural(count, kind)}" for kind, count in counts.items()
    )

    lines = []
    for entry in list(entries)[-max_entries:][::-1]:
        filed = entry.get("at")
        date = f"<t:{int(filed)}:R>" if isinstance(filed, (int, float)) else "date unknown"
        reason = f" — {entry['reason']}" if entry.get("reason") else ""
        case = str(entry.get("case_number", 0)).rjust(4, "0")
        badge = TYPE_BADGES.get(entry["type"], "•")
        lines.append(
            f"`#{case}` {badge} {entry['type'].upper()} · {date}{reason} "
            f"· officer <@{entry['officer_id']}>"
        )

    truncated = (
        f"\n… and {len(entries) - max_entries} older record(s). Full history stays on file."
        if len(entries) > max_entries
        else ""
    )
    body = f"📋 **RAP SHEET — {name}**\n{summary}\n\n" + "\n".join(lines) + truncated
    return body if len(body) <= MESSAGE_LIMIT else body[: MESSAGE_LIMIT - 4] + "\n[…]"


def next_case(sheet: Dict[str, Any]) -> int:
    return int(sheet.get("next_case_number", 1))


def build_entry(
    case_number: int,
    *,
    record_type: str,
    user_id: int,
    officer_id: int,
    reason: Optional[str],
    at: float,
    meta: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """One stored record. Raises on an unknown type — a typo must not create a
    category nobody ever reads."""
    if record_type not in RECORD_TYPES:
        raise ValueError(
            f'Unknown record type "{record_type}" — expected one of {", ".join(RECORD_TYPES)}'
        )
    return {
        "case_number": int(case_number),
        "type": record_type,
        "user_id": int(user_id),
        "officer_id": int(officer_id),
        "reason": reason,
        "meta": meta or {},
        "at": int(at),
    }


def filter_for(entries: Sequence[Dict[str, Any]], user_id: int) -> List[Dict[str, Any]]:
    """One member's records, oldest first."""
    return [e for e in entries if int(e.get("user_id", 0)) == int(user_id)]


def without(
    entries: Sequence[Dict[str, Any]], user_id: int, case_number: Optional[int] = None
) -> tuple:
    """``(kept, removed_count)`` after expunging a member's records."""
    kept, removed = [], 0
    for entry in entries:
        hit = int(entry.get("user_id", 0)) == int(user_id) and (
            case_number is None or int(entry.get("case_number", 0)) == int(case_number)
        )
        if hit:
            removed += 1
        else:
            kept.append(entry)
    return kept, removed
