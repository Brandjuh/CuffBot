"""The submission itself: the agency table, what a member may type, and how it renders.

Split out from the cog so the rules a submission has to satisfy can be read —
and tested — without a bot: which agencies exist and which of them ping,
what counts as a usable link, and how the finished memorial embed is built.

The embed built here is the *same object* at every stage: what the member sees
in their preview, what the admins weigh up in the review channel, and what
finally lands in the memorial channel. One builder, so a post can never look
different from the thing that was approved.
"""

from __future__ import annotations

import datetime as dt
import re
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import discord

#: The memorial channel's own colour, taken from ``cuffmemorial`` so a
#: member-submitted honour sits next to the tracker's without looking foreign.
MEMORIAL_COLOR = 0x2C3E50
PENDING_COLOR = 0xFEE75C
APPROVED_COLOR = 0x57F287
DENIED_COLOR = 0xED4245
#: Test posts are deliberately a colour the memorial channel never uses.
TEST_COLOR = 0x9B59B6

#: Discord's own ceilings, minus the room this cog needs underneath them.
#: An embed description holds 4096; the story is capped short of that so the
#: source line always fits under it, and a modal paragraph field caps at 4000
#: regardless. A title holds 256, and the name shares it with an emoji.
MAX_NAME = 100
MAX_EOW = 40
MAX_TEXT = 3500
#: Signed CDN links are long — a real fbcdn photo URL runs past 600 characters
#: of tokens, so a 400 cap would refuse exactly the links members paste.
MAX_URL = 1500
DESCRIPTION_LIMIT = 4096
TITLE_LIMIT = 256
FIELD_LIMIT = 1024

DEFAULT_LINK_TEXT = "Read the full story"
FOOTER_LINE = "Gone, but not forgotten."


@dataclass(frozen=True)
class Agency:
    """One kind of service, and whether it has people to call."""

    key: str
    label: str
    emoji: str
    #: The role tagged when a submission for this agency is approved.
    #: ``None`` is not an oversight — see ``ambulance`` below.
    role_id: Optional[int]
    blurb: str
    aliases: Tuple[str, ...]


#: The owner's four agencies. Three of the role ids are the precinct's
#: existing memorial roles, the same ones ``cuffmemorial`` tags for its feeds,
#: so a member submission and a tracker post reach exactly the same people.
#:
#: Ambulance carries ``role_id=None`` on purpose (owner, 2026-08-10): the
#: precinct has no EMS role to call, so those posts are published silently
#: rather than pinging a role that would be wrong.
AGENCIES: Dict[str, Agency] = {
    "police": Agency(
        key="police",
        label="Police",
        emoji="👮",
        role_id=627946543273738240,
        blurb="Law enforcement — police, sheriff, state trooper, federal.",
        aliases=("police", "cop", "cops", "leo", "officer", "sheriff", "trooper", "pd"),
    ),
    "fire": Agency(
        key="fire",
        label="Fire",
        emoji="🚒",
        role_id=627946690024046675,
        blurb="Fire service — career, volunteer and wildland firefighters.",
        aliases=("fire", "firefighter", "firefighters", "fd", "fireman", "wildland"),
    ),
    "correctional": Agency(
        key="correctional",
        label="Correctional",
        emoji="🔗",
        role_id=1533202959624830976,
        blurb="Corrections — correctional and detention officers.",
        aliases=(
            "correctional",
            "corrections",
            "correction",
            "co",
            "doc",
            "prison",
            "jail",
            "detention",
        ),
    ),
    "ambulance": Agency(
        key="ambulance",
        label="Ambulance",
        emoji="🚑",
        role_id=None,  # no EMS role in this guild — published without a ping
        blurb="Emergency medical services — EMTs, paramedics, ambulance crew.",
        aliases=("ambulance", "ems", "emt", "paramedic", "medic", "ambo"),
    ),
}

#: Fixed display order, so every list of agencies reads the same way.
AGENCY_ORDER: Tuple[str, ...] = ("police", "fire", "correctional", "ambulance")

_ALIAS_TO_KEY: Dict[str, str] = {
    alias: agency.key for agency in AGENCIES.values() for alias in agency.aliases
}


def parse_agency(raw: Optional[str]) -> Optional[str]:
    """The agency key behind whatever was typed, or ``None``.

    Members pick from a dropdown and cannot get this wrong, but an admin
    editing a submission types it into a modal, and "Fire Department" or
    "EMS" should not be rejected on spelling.
    """
    if not raw:
        return None
    text = " ".join(str(raw).strip().lower().split())
    if not text:
        return None
    if text in AGENCIES:
        return text
    if text in _ALIAS_TO_KEY:
        return _ALIAS_TO_KEY[text]
    # "fire department", "correctional officer", "police department": match on
    # the first word that is a known alias rather than demanding the exact one.
    for word in text.replace("/", " ").replace("-", " ").split():
        if word in _ALIAS_TO_KEY:
            return _ALIAS_TO_KEY[word]
    return None


def agency_for(key: Optional[str]) -> Agency:
    """The agency record, falling back to police for an unreadable key.

    A stored submission should never carry an unknown key, but rendering one
    must not raise in front of the admins reviewing it.
    """
    return AGENCIES.get(str(key or ""), AGENCIES["police"])


def role_id_for(key: str, overrides: Optional[Dict[str, object]] = None) -> Optional[int]:
    """The role to tag for an agency: the guild's override, else the default.

    An override of ``0`` is how "never ping for this agency" is stored, and it
    has to survive as ``None`` rather than being read as "unset".
    """
    if overrides and key in overrides:
        raw = overrides.get(key)
        if raw in (None, 0, "0", ""):
            return None
        try:
            return int(raw)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return None
    return AGENCIES[key].role_id if key in AGENCIES else None


def clean_url(raw: Optional[str]) -> Optional[str]:
    """A usable http(s) link, or ``None``.

    Members paste links out of chat, where they arrive wrapped in the angle
    brackets Discord uses to kill embeds, and out of browsers, where they
    arrive with a trailing full stop from the sentence around them.
    """
    if not raw:
        return None
    text = str(raw).strip().strip("<>").strip()
    if not text:
        return None
    # A link with whitespace in it is two things stuck together, not a link.
    if any(char.isspace() for char in text):
        return None
    lowered = text.lower()
    if not lowered.startswith(("http://", "https://")):
        return None
    remainder = text.split("://", 1)[1]
    host = remainder.split("/", 1)[0]
    if "." not in host or len(host) < 4:
        return None
    if len(text) > MAX_URL:
        return None
    return text


# ----------------------------------------------------------------------
# End of watch
# ----------------------------------------------------------------------

#: Hardcoded rather than strftime'd: %A/%B follow the process locale, and a
#: memorial must read "Sunday, August 3, 2026" whatever machine the bot is on.
WEEKDAY_LABELS = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
MONTH_LABELS = (
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
)

_MONTHS_BY_NAME: Dict[str, int] = {}
for _index, _label in enumerate(MONTH_LABELS, start=1):
    _MONTHS_BY_NAME[_label.lower()] = _index
    _MONTHS_BY_NAME[_label.lower()[:3]] = _index
_MONTHS_BY_NAME["sept"] = 9

#: ODMP has officers back to the 1790s; anything before that is a typo.
EOW_FIRST_YEAR = 1700

_EOW_NUMERIC = re.compile(r"^(\d{1,4})[-/. ](\d{1,2})[-/. ](\d{1,4})$")
#: "August 3, 2026" / "Aug 3rd 2026"
_EOW_MONTH_FIRST = re.compile(r"^([a-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$")
#: "3 August 2026" / "3rd aug 2026"
_EOW_DAY_FIRST = re.compile(r"^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\.?,?\s+(\d{4})$")


def _eow_iso(year: int, month: int, day: int) -> Optional[str]:
    if year < EOW_FIRST_YEAR:
        return None
    try:
        return dt.date(year, month, day).isoformat()
    except ValueError:
        return None


def eow_ambiguous(raw: Optional[str]) -> bool:
    """Whether a numeric date could honestly be read two ways.

    ``3/8/2026`` is March 8 to an American and August 3 to a European, and a
    memorial is the wrong place to guess. Its own predicate so the refusal
    can say *that* instead of a generic "could not be read".
    """
    if not raw:
        return False
    match = _EOW_NUMERIC.match(" ".join(str(raw).strip().lower().split()))
    if not match or len(match.group(1)) == 4 or len(match.group(3)) != 4:
        return False
    first, second = int(match.group(1)), int(match.group(2))
    return first <= 12 and second <= 12 and first != second


def parse_eow(raw: Optional[str]) -> Optional[str]:
    """The date behind whatever was typed, as ISO ``YYYY-MM-DD``, or ``None``.

    Accepted: ISO (``2026-08-03``), unambiguous numeric (``23/8/2026`` — one
    of the two numbers must be >12, or they must be equal), and written-out
    months either way around (``August 3, 2026`` / ``3 Aug 2026``). A date
    that could be read two ways is refused, not guessed — see
    ``eow_ambiguous``.
    """
    if not raw:
        return None
    text = " ".join(str(raw).strip().lower().split())
    if not text:
        return None

    match = _EOW_NUMERIC.match(text)
    if match:
        first, second, third = (int(g) for g in match.groups())
        if len(match.group(1)) == 4:
            return _eow_iso(first, second, third)
        if len(match.group(3)) == 4:
            if first > 12 >= second:
                return _eow_iso(third, second, first)
            if second > 12 >= first:
                return _eow_iso(third, first, second)
            if first == second:
                return _eow_iso(third, first, second)
        return None

    match = _EOW_MONTH_FIRST.match(text)
    if match and match.group(1) in _MONTHS_BY_NAME:
        return _eow_iso(int(match.group(3)), _MONTHS_BY_NAME[match.group(1)], int(match.group(2)))

    match = _EOW_DAY_FIRST.match(text)
    if match and match.group(2) in _MONTHS_BY_NAME:
        return _eow_iso(int(match.group(3)), _MONTHS_BY_NAME[match.group(2)], int(match.group(1)))

    return None


def format_eow(raw: Optional[str]) -> Optional[str]:
    """The date the way ODMP writes one: ``Sunday, August 3, 2026``."""
    iso = parse_eow(raw)
    if not iso:
        return None
    date = dt.date.fromisoformat(iso)
    return f"{WEEKDAY_LABELS[date.weekday()]}, {MONTH_LABELS[date.month - 1]} {date.day}, {date.year}"


def eow_problem(raw: Optional[str]) -> Optional[str]:
    """What is wrong with a typed End of watch, or ``None``. Empty is fine."""
    text = str(raw or "").strip()
    if not text:
        return None
    if eow_ambiguous(text):
        return (
            f"`{clip(text, 40)}` could be read two ways (day/month or month/day) — "
            "write the month out, like `August 3, 2026`."
        )
    iso = parse_eow(text)
    if iso is None:
        return (
            "The End of watch date could not be read — use `YYYY-MM-DD`, "
            "or write the month out (`August 3, 2026`)."
        )
    if iso > dt.date.today().isoformat():
        return "The End of watch date is in the future."
    return None


IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp")


def looks_like_image(url: Optional[str]) -> bool:
    """Whether a link is recognisably a direct image link.

    Only ever used to warn. Plenty of real image URLs are extensionless
    (CDN paths, query-signed links), so a ``False`` here is a hint to check
    the preview, never a reason to refuse the submission.
    """
    if not url:
        return False
    path = url.split("?", 1)[0].split("#", 1)[0].lower()
    return path.endswith(IMAGE_SUFFIXES)


def clip(text: Optional[str], limit: int) -> str:
    """Cut to a hard Discord limit, with an ellipsis when something was lost."""
    value = str(text or "").strip()
    if len(value) <= limit:
        return value
    return value[: limit - 1].rstrip() + "…"


def build_description(text: str, source: Optional[str]) -> str:
    """The story, with the source linked underneath it.

    Angle brackets around the URL stop a query string from breaking the
    markdown — the same guard ``cuffmemorial`` uses.
    """
    body = clip(text, MAX_TEXT)
    if source:
        read_more = f"[{DEFAULT_LINK_TEXT} →](<{source}>)"
        body = f"{body}\n\n{read_more}" if body else read_more
    return clip(body, DESCRIPTION_LIMIT)


def memorial_embed(
    submission: Dict[str, object],
    *,
    credit: Optional[str] = None,
    test: bool = False,
    photo_ref: Optional[str] = None,
) -> discord.Embed:
    """The honour itself — preview, review copy and published post in one.

    ``credit`` names the member who submitted it and is dropped into the
    footer; pass ``None`` to publish it unattributed. ``test`` only changes
    the colour and stamps the footer, so a test post can never be mistaken
    for the real thing in a channel that holds both.

    ``photo_ref`` is an ``attachment://`` reference to a photo mirrored onto
    the message this embed rides on. When given it wins over the submission's
    photo URL, because the mirrored copy cannot expire and the URL — see
    ``photo.py`` — very much can.
    """
    agency = agency_for(submission.get("agency"))
    name = clip(submission.get("name"), MAX_NAME)
    # Both links are re-cleaned here rather than trusted. This same builder
    # renders the *preview*, where the member may well have just pasted
    # something that is not a link at all — and Discord rejects a whole embed
    # over one malformed URL, which would break the very screen that exists to
    # show them what is wrong. A bad link is left out; the preview note names it.
    source = clean_url(submission.get("source"))
    photo = clean_url(submission.get("photo"))

    embed = discord.Embed(
        color=TEST_COLOR if test else MEMORIAL_COLOR,
        title=clip(f"🕯️ {agency.emoji} {name}", TITLE_LIMIT),
        description=build_description(str(submission.get("text") or ""), source) or None,
    )
    if source:
        embed.url = source
    embed.add_field(name="Agency", value=agency.label, inline=True)
    # The same field cuffmemorial's feeds carry, worded the same way.
    eow_text = format_eow(submission.get("eow"))
    if eow_text:
        embed.add_field(name="End of watch", value=eow_text, inline=True)
    if photo_ref:
        embed.set_image(url=photo_ref)
    elif photo:
        embed.set_image(url=photo)

    footer = FOOTER_LINE
    if credit:
        footer = f"{footer} · Submitted by {credit}"
    if test:
        footer = f"TEST POST — not a real memorial · {footer}"
    embed.set_footer(text=clip(footer, 2048))
    return embed
