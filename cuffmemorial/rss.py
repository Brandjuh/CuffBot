"""Minimal, tolerant RSS parsing — port of the Node module's ``lib/rss.js``.

We only need four fields per item (id, title, link, date), so this is a
targeted extractor rather than a full XML parser: it survives CDATA, entities,
attribute-bearing tags and unknown extra elements. Anything unparseable yields
an empty list, which the caller reads as "nothing new" — never a crash.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional, Sequence

ENTITIES = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'", "nbsp": " "}

_ITEM_RE = re.compile(r"<item(?:\s[^>]*)?>.*?</item>", re.IGNORECASE | re.DOTALL)
_CDATA_RE = re.compile(r"^<!\[CDATA\[(.*?)\]\]>$", re.DOTALL)
_HEX_RE = re.compile(r"&#x([0-9a-f]+);", re.IGNORECASE)
_DEC_RE = re.compile(r"&#(\d+);")
_NAMED_RE = re.compile(r"&([a-z]+);", re.IGNORECASE)

#: Post at most this many per feed per sweep; the rest waits for the next one.
DEFAULT_CAP = 5
#: How many seen ids to remember per feed.
DEFAULT_KEEP = 200


def decode_entities(text: Any) -> str:
    """Decode the handful of entities that actually occur in feed titles."""
    value = str(text or "")
    value = _HEX_RE.sub(lambda m: chr(int(m.group(1), 16)), value)
    value = _DEC_RE.sub(lambda m: chr(int(m.group(1))), value)
    return _NAMED_RE.sub(lambda m: ENTITIES.get(m.group(1).lower(), m.group(0)), value)


def _first_tag(block: str, tag: str) -> Optional[str]:
    """The text of the FIRST ``<tag>…</tag>`` in a block, CDATA unwrapped."""
    match = re.search(
        rf"<{tag}(?:\s[^>]*)?>(.*?)</{tag}>", block, re.IGNORECASE | re.DOTALL
    )
    if not match:
        return None
    value = match.group(1).strip()
    cdata = _CDATA_RE.match(value)
    if cdata:
        value = cdata.group(1).strip()
    return decode_entities(value).strip()


def parse_feed(xml: Any) -> List[Dict[str, Optional[str]]]:
    """Parse an RSS 2.0 (or close enough) document, in document order.

    Items without a usable id (``guid``, falling back to ``link``) are dropped
    — without one we cannot dedupe them, and a memorial posted twice is worse
    than one posted late.
    """
    items: List[Dict[str, Optional[str]]] = []
    for block in _ITEM_RE.findall(str(xml or "")):
        guid = _first_tag(block, "guid")
        link = _first_tag(block, "link")
        identifier = guid or link
        if not identifier:
            continue
        items.append(
            {
                "id": identifier,
                "title": _first_tag(block, "title") or "(untitled)",
                "link": link,
                "pub_date": _first_tag(block, "pubDate"),
            }
        )
    return items


def unseen_items(
    items: Sequence[Mapping[str, Any]], seen_ids: Sequence[str], cap: int = DEFAULT_CAP
) -> List[Mapping[str, Any]]:
    """The new items, OLDEST FIRST so the channel reads chronologically."""
    seen = set(seen_ids or ())
    fresh = [item for item in items if item["id"] not in seen][:cap]
    return fresh[::-1]


def merge_seen(
    previous: Optional[Sequence[str]], new_ids: Sequence[str], keep: int = DEFAULT_KEEP
) -> List[str]:
    """Merge newly seen ids in, keeping only the newest ``keep``."""
    return [*(previous or []), *new_ids][-keep:]


def item_matches_feed(match: Optional[Mapping[str, Any]], item: Mapping[str, Any]) -> bool:
    """Per-feed item filter.

    Some sources have no memorial-only feed — firehero.org's carries all site
    news — so a feed can declare match rules and only matching items are
    honoured. An item passes when any rule group hits; no rules means pass.
    """
    link_needles = (match or {}).get("link_includes") or []
    title_needles = (match or {}).get("title_includes") or []
    if not link_needles and not title_needles:
        return True
    link = str(item.get("link") or "").lower()
    title = str(item.get("title") or "").lower()
    return any(str(n).lower() in link for n in link_needles) or any(
        str(n).lower() in title for n in title_needles
    )
