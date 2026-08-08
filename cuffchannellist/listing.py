"""Pure channel-list logic — port of the Node module's ``lib/list.js`` (itself
a port of the FRA bot's ``channellist`` cog).

Renders the server's categories and channels into embed-sized chunks, and
decides whether a fresh render needs an edit, a repost, or nothing at all. No
discord objects: the cog flattens its channel cache into plain dicts first.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional, Sequence

#: Stays under Discord's 4096-character embed description cap.
CHUNK_CHAR_LIMIT = 4000
#: Debounce: a burst of channel edits becomes one refresh.
AUTO_UPDATE_DELAY_S = 10
MAX_HEADER_LENGTH = 1500

DEFAULT_HEADER = "All public channels and their description are listed below."
DEFAULT_EMBED_COLOR = 0x5865F2
EMPTY_LIST_PLACEHOLDER = "*There are no channels to display.*"

ACTION_SKIP = "skip"
ACTION_EDIT = "edit"
ACTION_REPOST = "repost"


def normalize_topic(topic: Any) -> str:
    """Collapse a channel topic to a single line."""
    if not topic:
        return ""
    return " ".join(str(topic).split())


def format_channel_line(mention: str, topic: Any) -> str:
    clean = normalize_topic(topic)
    return f"{mention} - {clean}" if clean else mention


def format_category_header(name: str, emoji: Optional[str] = None) -> str:
    """Bracket the category name — but only once.

    Plenty of categories are already named ``[ 🚔 POLITIE ]``; wrapping those
    again gave ``[[ 🚔 POLITIE ]]``. A name that already carries its own
    brackets is used as-is, spacing included.
    """
    label = str(name).strip()
    if not (label.startswith("[") and label.endswith("]")):
        label = f"[{label}]"
    return f"**[{emoji}] {label} [{emoji}]**" if emoji else f"**{label}**"


def group_by_category(
    descriptors: Sequence[Mapping[str, Any]],
    *,
    include_voice: bool = True,
    ignored_ids: Sequence[Any] = (),
) -> List[Dict[str, Any]]:
    """Group channels the way the Discord client shows them.

    Channels above the first category come first with no header, then each
    category by position; inside a group, text-like channels sit above
    voice-like ones. An ignored category hides everything in it, and a channel
    whose parent is unknown falls back to the top block — which is how Discord
    renders orphans too.
    """
    ignored = {str(i) for i in ignored_ids}
    categories = sorted(
        (d for d in descriptors if d["kind"] == "category" and str(d["id"]) not in ignored),
        key=lambda d: d["position"],
    )
    groups: Dict[Any, List[Mapping[str, Any]]] = {None: []}
    for category in categories:
        groups[category["id"]] = []

    for descriptor in descriptors:
        if descriptor["kind"] == "category":
            continue
        if str(descriptor["id"]) in ignored:
            continue
        if not include_voice and descriptor["kind"] == "voice":
            continue
        if not descriptor.get("visible"):
            continue
        parent = descriptor.get("parent_id")
        if parent is None:
            groups[None].append(descriptor)
        elif parent in groups:
            groups[parent].append(descriptor)
        elif str(parent) not in ignored:
            groups[None].append(descriptor)  # orphan: parent unknown

    def entries_for(items: Sequence[Mapping[str, Any]]) -> List[Dict[str, Any]]:
        ordered = sorted(items, key=lambda d: (1 if d["kind"] == "voice" else 0, d["position"]))
        return [{"mention": d["mention"], "topic": d.get("topic")} for d in ordered]

    result: List[Dict[str, Any]] = []
    if groups[None]:
        result.append({"name": None, "entries": entries_for(groups[None])})
    for category in categories:
        if groups[category["id"]]:
            result.append(
                {"name": category["name"], "entries": entries_for(groups[category["id"]])}
            )
    return result


def render_blocks(
    categories: Sequence[Mapping[str, Any]], emoji: Optional[str] = None
) -> List[List[str]]:
    """Grouped categories into blocks of lines."""
    blocks = []
    for group in categories:
        if not group.get("entries"):
            continue
        lines = []
        if group.get("name") is not None:
            lines.append(format_category_header(group["name"], emoji))
        lines.extend(format_channel_line(e["mention"], e.get("topic")) for e in group["entries"])
        blocks.append(lines)
    return blocks


def chunk_blocks(
    header: Any, blocks: Sequence[Sequence[str]], limit: int = CHUNK_CHAR_LIMIT
) -> List[str]:
    """Pack header and blocks into embed-sized chunks.

    A block's first line is kept together with the one after it, so a category
    header is never stranded at the bottom of one message while its channels
    start in the next.
    """
    chunks: List[str] = []
    current = str(header or "").strip()[:limit]
    for block in blocks:
        lines = [line[:limit] for line in block if line]
        for index, line in enumerate(lines):
            if index == 0:
                needed = len("\n".join(lines[:2]))
                if current and len(current) + 2 + needed > limit:
                    chunks.append(current)
                    current = ""
                separator = "\n\n" if current else ""
            else:
                separator = "\n" if current else ""
            candidate = f"{current}{separator}{line}"
            if current and len(candidate) > limit:
                chunks.append(current)
                current = line
            else:
                current = candidate
    if current:
        chunks.append(current)
    return chunks


def decide_action(
    new_chunks: Sequence[str], existing_contents: Optional[Sequence[str]]
) -> str:
    """How a freshly rendered list should be applied.

    ``existing_contents`` must be None when nothing usable is posted (no stored
    messages, or one of them is gone) — that always forces a repost. Editing is
    only possible when every stored message still exists and the new list needs
    no more messages than are already up.
    """
    if not existing_contents:
        return ACTION_REPOST
    if len(new_chunks) > len(existing_contents):
        return ACTION_REPOST
    if len(new_chunks) == len(existing_contents) and list(new_chunks) == list(existing_contents):
        return ACTION_SKIP
    return ACTION_EDIT


def parse_hex_color(value: Any) -> Optional[int]:
    """``#5865f2`` → int, or None when it is not a hex colour."""
    cleaned = str(value or "").strip().lstrip("#")
    if not re.fullmatch(r"[0-9a-fA-F]{1,6}", cleaned):
        return None
    return int(cleaned, 16)


def normalize_emoji_input(value: Any) -> str:
    """``none``/``off``/empty removes the decoration."""
    text = str(value or "").strip()
    if not text or text.lower() in ("none", "off"):
        return ""
    return text[:80]
