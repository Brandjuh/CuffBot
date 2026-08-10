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
MAX_TEXT = 3500
MAX_URL = 400
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
) -> discord.Embed:
    """The honour itself — preview, review copy and published post in one.

    ``credit`` names the member who submitted it and is dropped into the
    footer; pass ``None`` to publish it unattributed. ``test`` only changes
    the colour and stamps the footer, so a test post can never be mistaken
    for the real thing in a channel that holds both.
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
    if photo:
        embed.set_image(url=photo)

    footer = FOOTER_LINE
    if credit:
        footer = f"{footer} · Submitted by {credit}"
    if test:
        footer = f"TEST POST — not a real memorial · {footer}"
    embed.set_footer(text=clip(footer, 2048))
    return embed
