"""The interception layer: turn another cog's plain-text reply into an embed.

Stock and third-party cogs (Red's own ``economy``, YamiCogs' ``payday``, …) send
plain strings. They are upstream code, so editing them is not an option: a cog
update overwrites the file and the change is gone. Instead this module wraps the
two send paths every cog goes through and rewrites the *message* on its way out:

* :meth:`redbot.core.commands.Context.send` — everything a command replies with.
* :meth:`discord.abc.Messageable.send` — the event-driven posts (a cash drop, a
  heist announcement) that never touch a ``Context``.

Only cogs on the caller's allow-list are touched; every other send is handed to
the original method untouched. The ``Context`` path knows which cog it belongs to
(``ctx.cog``); the channel path does not, so the caller is identified by walking
the Python stack for the first frame belonging to an allow-listed package. That
is the whole trick — the rest of this module is the decision (should this text
become an embed at all?) and the presentation (which title and colour).

Everything here is written so a failure degrades to the original behaviour: the
patched methods swallow any exception from the decision path and fall back to
sending the plain string, because a bug in a global message hook would otherwise
silence the entire bot.
"""

from __future__ import annotations

import logging
import re
import sys
from dataclasses import dataclass
from typing import Iterable, Optional, Set, Tuple

import discord
from redbot.core import commands

log = logging.getLogger("red.cuff-cogs.cuffembed")

#: Discord's ceiling for an embed description. Longer text stays plain rather
#: than being truncated — losing part of a reply is worse than an ugly one.
MAX_DESCRIPTION = 4096

#: The precinct's default embed colour (same gold the other cuff-cogs use).
NEUTRAL = 0xF1C40F
GREEN = 0x57F287
ORANGE = 0xE67E22
RED = 0xED4245

#: Frames from these modules are never the "calling cog" — they are the wrapper
#: itself, Red's plumbing, or discord.py.
_SKIP_PREFIXES = ("cuffembed", "discord.", "redbot.core.")

#: A message that is nothing but a link keeps its Discord link preview, which an
#: embed would swallow.
_URL_ONLY = re.compile(r"^<?https?://\S+>?$")

#: Kwargs that mean "this is not a plain text message": the reply already
#: carries an embed, or it is an interactive menu, a poll, a sticker. Tested for
#: PRESENCE, not truthiness — an embed carrying only a colour is falsy
#: (``Embed.__len__`` counts its text), and overwriting one would lose it.
_PRESENT_KWARGS = ("embed", "embeds", "view", "stickers", "poll")

#: Flags where the value itself is the answer.
_FLAG_KWARGS = ("tts", "suppress_embeds")

_LEADING_MENTIONS = re.compile(r"^((?:<@[!&]?\d+>|\s)+)")


@dataclass(frozen=True)
class Rule:
    """A recognised message: which title and colour it gets."""

    pattern: re.Pattern
    title: Optional[str]
    color: int


def _rule(pattern: str, title: Optional[str], color: int) -> Rule:
    return Rule(re.compile(pattern, re.IGNORECASE), title, color)


#: Recognised messages, in order — the FIRST match wins, so the specific ones
#: come before the general ones. Anything unmatched still becomes an embed, just
#: without a title and in the default colour. The patterns are deliberately
#: matched against fragments of the upstream strings (not whole sentences), so a
#: reworded upstream message degrades to the plain-gold embed instead of
#: crashing or matching the wrong rule.
RULES: Tuple[Rule, ...] = (
    # Red's economy payday + the payday cog's freecredits payouts.
    _rule(
        r"here, take some|you have been given|you have claimed all available|enjoy the fruits",
        "💰 Payday",
        GREEN,
    ),
    # Both cogs' cooldown refusals ("Too soon…", "you still have X until your…").
    _rule(r"too soon|until your next", "⏳ Not yet", ORANGE),
    _rule(r"you have no available|no freecredit options have been configured", "🪙 Nothing to claim", NEUTRAL),
    _rule(r"reached the maximum amount", "🏦 Vault full", ORANGE),
    _rule(r"\btransferred\b", "🏦 Transfer", GREEN),
    _rule(r"balance is", "🏦 Balance", NEUTRAL),
    _rule(r"^setting saved", "✅ Setting saved", GREEN),
    _rule(
        r"non-negative value|you can't afford|not enough|insufficient|invalid amount",
        "🚫 No can do",
        RED,
    ),
)


# ---------------------------------------------------------------------------
# Who is calling?
# ---------------------------------------------------------------------------


def package_key(module_name: str) -> Optional[str]:
    """The allow-list key for a module name.

    Downloaded cogs are imported as their own top-level package
    (``payday.payday`` → ``payday``), Red's own cogs live under
    ``redbot.cogs.<name>`` (``redbot.cogs.economy.economy`` → ``economy``).
    Anything else in ``redbot`` is core plumbing and belongs to no cog.
    """
    if not module_name:
        return None
    parts = module_name.split(".")
    if parts[0] == "redbot":
        if len(parts) >= 3 and parts[1] == "cogs":
            return parts[2].lower()
        return None
    return parts[0].lower()


def cog_keys(cog: Optional[commands.Cog]) -> Set[str]:
    """Every name an allow-list entry may use for this cog.

    Both the package (``payday``) and the cog class' display name (``PayDay`` →
    ``payday``) count, because the owner may reasonably type either.
    """
    if cog is None:
        return set()
    keys = set()
    key = package_key(type(cog).__module__)
    if key:
        keys.add(key)
    name = getattr(cog, "qualified_name", None)
    if name:
        keys.add(name.lower())
    return keys


def caller_key(candidates: Iterable[str], *, max_depth: int = 25) -> Optional[str]:
    """Walk the stack for the first frame belonging to an allow-listed package.

    Used on the ``channel.send`` path, where nothing identifies the caller. The
    walk stops at the first hit, so an allow-listed cog calling through a helper
    module is still recognised, while a send from anywhere else returns ``None``
    and is left alone.
    """
    wanted = {c.lower() for c in candidates}
    if not wanted:
        return None
    try:
        frame = sys._getframe(1)
    except (ValueError, AttributeError):  # pragma: no cover - CPython always has it
        return None
    depth = 0
    while frame is not None and depth < max_depth:
        module_name = frame.f_globals.get("__name__", "")
        if not module_name.startswith(_SKIP_PREFIXES):
            key = package_key(module_name)
            if key and key in wanted:
                return key
        frame = frame.f_back
        depth += 1
    return None


# ---------------------------------------------------------------------------
# Should this text become an embed?
# ---------------------------------------------------------------------------


def should_embed(content, kwargs: dict) -> bool:
    """True when ``content`` is a plain text message worth wrapping."""
    for key in _PRESENT_KWARGS:
        if kwargs.get(key) is not None:
            return False
    for key in _FLAG_KWARGS:
        if kwargs.get(key):
            return False
    if content is None:
        return False
    text = str(content).strip()
    if len(text) < 3:  # a bare "✅" is not a message that wants a box around it
        return False
    if len(text) > MAX_DESCRIPTION:
        return False
    if _URL_ONLY.match(text):
        return False
    return True


def can_embed(destination) -> bool:
    """Whether the bot may actually post an embed in ``destination``."""
    try:
        guild = getattr(destination, "guild", None)
        me = getattr(guild, "me", None)
        if me is None or not hasattr(destination, "permissions_for"):
            return True  # DMs and anything unusual: nothing to check
        return destination.permissions_for(me).embed_links
    except Exception:
        return True


# ---------------------------------------------------------------------------
# Presentation
# ---------------------------------------------------------------------------


def match_rule(text: str) -> Optional[Rule]:
    for rule in RULES:
        if rule.pattern.search(text):
            return rule
    return None


def split_leading_mentions(text: str) -> Tuple[str, str]:
    """Split a leading run of mentions off the front of ``text``.

    Red's payday opens with ``{author.mention}``. A mention inside an embed
    renders but never pings, so when pings are wanted the mention is lifted out
    and sent as message content instead of being repeated in the description.
    """
    match = _LEADING_MENTIONS.match(text)
    if not match:
        return "", text
    return match.group(1).strip(), text[match.end() :].lstrip()


def build_embed(
    content, default_color: int, *, ping: bool = False
) -> Tuple[discord.Embed, Optional[str]]:
    """Render ``content`` as an embed.

    Returns the embed plus the message content to send alongside it — a mention
    when pings are on, otherwise ``None``.
    """
    text = str(content)
    rule = match_rule(text)
    ping_content: Optional[str] = None
    body = text
    if ping:
        mentions, rest = split_leading_mentions(text)
        if mentions and rest:
            ping_content = mentions
            body = rest
    embed = discord.Embed(
        description=body.strip() or "​",
        color=rule.color if rule else default_color,
    )
    if rule and rule.title:
        embed.title = rule.title
    return embed, ping_content


# ---------------------------------------------------------------------------
# The patches
# ---------------------------------------------------------------------------

_original_context_send = None
_original_messageable_send = None
_policy = None


def is_installed() -> bool:
    return getattr(commands.Context.send, "__cuffembed__", False) is True


async def _run(policy, destination, content, kwargs, keys, *, via_context: bool):
    """Ask the policy for an embed, never raising."""
    try:
        return await policy.plan(destination, content, kwargs, keys, via_context=via_context)
    except Exception:
        log.warning("CuffEmbed: falling back to plain text", exc_info=True)
        return None


def install(policy) -> None:
    """Route both send paths through ``policy``.

    ``policy`` is the cog; it must provide
    ``plan(destination, content, kwargs, keys, *, via_context)`` returning
    ``(embed, ping_content)`` or ``None``, and ``allowed_keys()``.
    """
    global _original_context_send, _original_messageable_send, _policy

    if is_installed():  # a reload without a clean unload
        remove()

    _policy = policy
    _original_context_send = commands.Context.send
    _original_messageable_send = discord.abc.Messageable.send

    original_context_send = _original_context_send
    original_messageable_send = _original_messageable_send

    async def context_send(self, content=None, **kwargs):
        plan = None
        if _policy is not None:
            text = content
            message_filter = kwargs.get("filter")
            # Red applies `filter` to the content it sends; the embed body has to
            # go through the same filter or the wrapper would smuggle text past it.
            if callable(message_filter) and text:
                try:
                    text = message_filter(str(text))
                except Exception:
                    text = content
            plan = await _run(
                _policy, self.channel, text, kwargs, cog_keys(self.cog), via_context=True
            )
        if plan is None:
            return await original_context_send(self, content, **kwargs)
        embed, ping_content = plan
        # A caller may have passed an explicit `embed=None`; drop it so the
        # rewritten call cannot pass the keyword twice.
        kwargs.pop("embed", None)
        kwargs.pop("embeds", None)
        if ping_content and "allowed_mentions" not in kwargs:
            kwargs["allowed_mentions"] = discord.AllowedMentions(
                everyone=False, roles=False, users=True
            )
        return await original_context_send(self, ping_content, embed=embed, **kwargs)

    async def messageable_send(self, content=None, **kwargs):
        plan = None
        if _policy is not None:
            try:
                keys = {caller_key(_policy.allowed_keys())} - {None}
            except Exception:
                keys = set()
            if keys:
                plan = await _run(_policy, self, content, kwargs, keys, via_context=False)
        if plan is None:
            return await original_messageable_send(self, content, **kwargs)
        embed, ping_content = plan
        kwargs.pop("embed", None)
        kwargs.pop("embeds", None)
        if ping_content and "allowed_mentions" not in kwargs:
            kwargs["allowed_mentions"] = discord.AllowedMentions(
                everyone=False, roles=False, users=True
            )
        return await original_messageable_send(self, ping_content, embed=embed, **kwargs)

    context_send.__cuffembed__ = True
    messageable_send.__cuffembed__ = True
    # The original is carried on the patch itself, not only in this module's
    # globals: reloading the cog re-imports this module with empty globals, and
    # without this the old patch could never be peeled off again.
    context_send.__cuffembed_original__ = original_context_send
    messageable_send.__cuffembed_original__ = original_messageable_send
    commands.Context.send = context_send
    discord.abc.Messageable.send = messageable_send


def _unwrap(current, fallback):
    """Peel every cuffembed layer off ``current`` and return the real original."""
    depth = 0
    while getattr(current, "__cuffembed__", False) and depth < 10:
        nxt = getattr(current, "__cuffembed_original__", None)
        if nxt is None:
            return fallback if fallback is not None else current
        current = nxt
        depth += 1
    return current


def remove() -> None:
    """Put the original methods back."""
    global _original_context_send, _original_messageable_send, _policy

    commands.Context.send = _unwrap(commands.Context.send, _original_context_send)
    discord.abc.Messageable.send = _unwrap(
        discord.abc.Messageable.send, _original_messageable_send
    )
    _original_context_send = None
    _original_messageable_send = None
    _policy = None
