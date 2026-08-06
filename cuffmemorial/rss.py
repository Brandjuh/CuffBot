"""Minimal, tolerant RSS parsing — port of the Node module's ``lib/rss.js``.

A targeted extractor rather than a full XML parser: it survives CDATA,
entities, attribute-bearing tags and unknown extra elements. Anything
unparseable yields an empty list, which the caller reads as "nothing new" —
never a crash.

Per item we pull the id, title, link, date, an end-of-watch date, a plain-text
summary and every image the item carries. The last three are what turn a bare
link into an embed that actually honours someone.

One thing to know about odmp.org before reading :func:`name_from_link`: an
item's ``<title>`` is the **agency**, not the officer. The officer's name lives
in the profile slug and again in the summary text. So the name is rebuilt from
the slug, then looked up in the summary to recover the capitalisation and
punctuation a slug throws away (``o-brien`` -> ``O'Brien``).
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional, Sequence

ENTITIES = {"amp": "&", "lt": "<", "gt": ">", "quot": '"', "apos": "'", "nbsp": " "}

_ITEM_RE = re.compile(r"<item(?:\s[^>]*)?>.*?</item>", re.IGNORECASE | re.DOTALL)
_CDATA_RE = re.compile(r"<!\[CDATA\[(.*?)\]\]>", re.DOTALL)
_HEX_RE = re.compile(r"&#x([0-9a-f]+);", re.IGNORECASE)
_DEC_RE = re.compile(r"&#(\d+);")
_NAMED_RE = re.compile(r"&([a-z]+);", re.IGNORECASE)

_TAG_RE = re.compile(r"<[^>]+>")
#: Tags that end a block of text, so the text reads as paragraphs without them.
_BLOCK_END_RE = re.compile(
    r"</p\s*>|<br\s*/?>|</div\s*>|</li\s*>|</h[1-6]\s*>|</blockquote\s*>", re.IGNORECASE
)
_IMG_SRC_RE = re.compile(r"<img\b[^>]*?\bsrc\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE)
_MEDIA_URL_RE = re.compile(
    r"<media:(?:content|thumbnail)\b[^>]*?\burl\s*=\s*[\"']([^\"']+)[\"']", re.IGNORECASE
)
_ENCLOSURE_RE = re.compile(r"<enclosure\b[^>]*>", re.IGNORECASE)
_ATTR_RE = re.compile(r"\b(\w+)\s*=\s*[\"']([^\"']*)[\"']")
#: WordPress feeds (firehero.org) append this to every description.
_WP_TRAILER_RE = re.compile(
    r"\s*The post\b.*?\bappeared first on\b.*$", re.IGNORECASE | re.DOTALL
)
_SLUG_ID_RE = re.compile(r"^\d+[-_]")
#: Slug tokens whose real spelling is not simply "capitalise it": generational
#: suffixes and the one acronym that shows up in ranks ("deputy-us-marshal").
TOKEN_SPELLINGS = {
    "ii": "II",
    "iii": "III",
    "iv": "IV",
    "jr": "Jr.",
    "sr": "Sr.",
    "us": "US",
}

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
    """The text of the FIRST ``<tag>…</tag>`` in a block, CDATA unwrapped.

    Every CDATA section is unwrapped, not just a section spanning the whole
    value: odmp.org writes its descriptions as two CDATA-wrapped images
    followed by bare text, and treating that as opaque loses both the photo
    and the story.
    """
    match = re.search(
        rf"<{tag}(?:\s[^>]*)?>(.*?)</{tag}>", block, re.IGNORECASE | re.DOTALL
    )
    if not match:
        return None
    value = _CDATA_RE.sub(lambda m: m.group(1), match.group(1)).strip()
    return decode_entities(value).strip()


def strip_html(html: Any) -> str:
    """Plain readable text from a feed description.

    Paragraph-ending tags become blank lines first: an article whose markup is
    the only thing separating its paragraphs should still read as paragraphs
    once the markup is gone.
    """
    text = _BLOCK_END_RE.sub("\n\n", str(html or ""))
    text = _TAG_RE.sub(" ", text)
    text = decode_entities(text)
    text = _WP_TRAILER_RE.sub("", text)
    # Collapse runs of spaces, then trim each line and cap blank runs at one.
    text = re.sub(r"[ \t\r\f\v]+", " ", text)
    text = "\n".join(line.strip() for line in text.split("\n"))
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def shorten(text: Any, limit: int) -> str:
    """Trim to ``limit`` characters on a word boundary, with an ellipsis."""
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    cut = value[: limit - 1]
    space = cut.rfind(" ")
    if space > limit // 2:
        cut = cut[:space]
    return cut.rstrip(" ,;:.-") + "…"


def extract_images(block: str, description_html: Optional[str] = None) -> List[str]:
    """Every image URL an item carries, in document order, deduplicated.

    Covers the three ways feeds attach one: ``<img>`` inside the description,
    ``<media:content>``/``<media:thumbnail>``, and an image ``<enclosure>``.
    """
    urls: List[str] = []
    urls.extend(_IMG_SRC_RE.findall(description_html or ""))
    urls.extend(_MEDIA_URL_RE.findall(block))
    for tag in _ENCLOSURE_RE.findall(block):
        attrs = dict(_ATTR_RE.findall(tag))
        if attrs.get("url") and attrs.get("type", "").lower().startswith("image/"):
            urls.append(attrs["url"])

    seen, ordered = set(), []
    for url in urls:
        url = decode_entities(url).strip()
        if url.lower().startswith(("http://", "https://")) and url not in seen:
            seen.add(url)
            ordered.append(url)
    return ordered


def _titlecase_token(token: str) -> str:
    return TOKEN_SPELLINGS.get(token.lower()) or (token[:1].upper() + token[1:].lower())


def name_from_link(link: Any, text: Any = None) -> Optional[str]:
    """The person's name, rebuilt from a profile URL slug.

    ``…/officer/27881-master-deputy-sheriff-jillian-olson`` gives
    ``Master Deputy Sheriff Jillian Olson``. A slug has lost the original
    capitalisation and punctuation, so when ``text`` (the item's summary, which
    opens with the same name) contains the slug's words, the spelling from
    *there* wins — that is what keeps ``O'Brien`` from becoming ``O Brien``.
    """
    slug = str(link or "").split("?")[0].split("#")[0].rstrip("/").rsplit("/", 1)[-1]
    tokens = [t for t in _SLUG_ID_RE.sub("", slug).split("-") if t]
    if not tokens:
        return None

    if text:
        # Words in order, with any punctuation or spacing between them.
        pattern = re.compile(
            r"\b" + r"[\s'’.\-]*".join(re.escape(t) for t in tokens) + r"\b", re.IGNORECASE
        )
        match = pattern.search(str(text))
        if match:
            return match.group(0).strip()
    return " ".join(_titlecase_token(t) for t in tokens)


def parse_feed(xml: Any) -> List[Dict[str, Any]]:
    """Parse an RSS 2.0 (or close enough) document, in document order.

    Items without a usable id (``guid``, falling back to ``link``) are dropped
    — without one we cannot dedupe them, and a memorial posted twice is worse
    than one posted late.
    """
    items: List[Dict[str, Any]] = []
    for block in _ITEM_RE.findall(str(xml or "")):
        guid = _first_tag(block, "guid")
        link = _first_tag(block, "link")
        identifier = guid or link
        if not identifier:
            continue
        description = _first_tag(block, "description")
        # WordPress feeds put a teaser in <description> and the real article in
        # <content:encoded> — cpof.org keeps its photos only in the latter.
        content = _first_tag(block, "content:encoded")
        items.append(
            {
                "id": identifier,
                "title": _first_tag(block, "title") or "(untitled)",
                "link": link,
                "pub_date": _first_tag(block, "pubDate"),
                # odmp.org's own element: the date of death.
                "end_of_watch": _first_tag(block, "endofwatch"),
                "summary": strip_html(content or description),
                "images": extract_images(block, f"{content or ''}{description or ''}"),
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
