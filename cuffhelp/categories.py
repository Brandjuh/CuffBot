"""Category map and page building for the button help menu.

Red has no notion of a command category — it groups by cog, and this bot runs
73 of them, which is exactly the wall of names the panel exists to replace. So
categories are defined here: an ordered list of buckets, each holding the cogs
that belong in it.

Matching is on the cog's ``qualified_name`` lowercased. Package name and class
name agree once lowercased for nearly every cog (``cufflevels`` → ``CuffLevels``);
where they do not (Red's ``customcom`` package is the ``CustomCommands`` class)
both spellings are listed. Anything unmatched lands in "Other", visibly, rather
than being silently dropped — and can be reassigned with a command.

Nothing here imports discord.py, so the bucketing and the pagination are
testable on plain strings.
"""

from typing import Dict, List, Optional, Sequence, Tuple

OTHER = "Other"
OTHER_EMOJI = "📦"

#: Server configuration lives in its own bucket, whatever cog it came from:
#: `triviaset` belongs next to `crackpotset`, not buried in Games. Red's
#: convention is that a config group is named ``<thing>set``, so the rule is
#: the name, applied at runtime to the real command — grepping sources misses
#: the ones declared through the function name (``triviaset`` is one).
ADMIN = "Admin"
ADMIN_EMOJI = "🔧"

#: A top-level command whose name ends in one of these is configuration.
ADMIN_SUFFIXES = ("set", "config", "settings")

#: Config groups on this bot that do NOT follow the naming convention. Only
#: groups where EVERY subcommand is gated belong here — `birthday`, `ht` and
#: `transcribe` are deliberately absent, because members need to find
#: `birthday set` and `ht tz` in their own category.
ADMIN_COMMANDS = {
    "set",        # Red's own bot-settings group
    "starboard",  # CuffStarboard: the whole group is admin-gated
    "ai",         # CuffDetective
    "helpmenu",   # this cog
}

#: Names that end in "set" but are not settings. Extendable from Discord.
ADMIN_EXCLUDE = {"asset", "offset", "closet", "sunset"}

#: (category, emoji, cogs). Order is the button order.
DEFAULT_CATEGORIES: List[Tuple[str, str, List[str]]] = [
    (
        "Moderation",
        "🛡️",
        [
            "mod", "modlog", "mutes", "warnings", "filter", "cleanup", "lockdown",
            "commandlock", "reports", "appeals", "permissions", "permchecker", "flag",
        ],
    ),
    (
        "Games",
        "🎮",
        [
            "trivia", "battleship", "hangman", "monopoly", "mafiagame", "minigames",
            "partygames", "wordlegame", "splitorstealgame", "simplecasino", "heist",
            "easterhunt", "crookhunt", "crackpot", "killcounter", "city",
        ],
    ),
    (
        "Economy",
        "💰",
        [
            "economy", "bank", "bankbackup", "economytrack", "economytrickle",
            "extendedeconomy", "payday", "cashdrop",
        ],
    ),
    (
        "Information",
        "ℹ️",
        ["general", "userinfo", "betteruptime", "system", "cuffhelp"],
    ),
    (
        "Media",
        "🎵",
        ["audio", "streams", "image", "perform"],
    ),
    (
        "Community",
        "🎭",
        [
            "cufflevels", "cuffstarboard", "cuffaffairs", "cuffbirthday", "highlight",
            "quoter", "ideaboard", "firstmessage", "joinmessage", "gptwelcome",
            "memberprefix",
        ],
    ),
    (
        "Utility",
        "🛠️",
        [
            "cuffhammertime", "cufftranscribe", "cuffdetective", "alias", "customcom",
            "customcommands", "embeditor", "converters", "caseinsensitive", "mover",
            "roomer", "autoroler",
        ],
    ),
    # Admin holds no cogs — commands land here by name, see is_admin_command.
    (ADMIN, ADMIN_EMOJI, []),
    (
        "Owner",
        "⚙️",
        [
            "downloader", "admin", "redupdate", "shell", "repomanager", "cogmanager",
            "sharedcog", "aaa3a_utils", "core", "dev",
        ],
    ),
]


def build_lookup(
    categories: Sequence[Tuple[str, str, Sequence[str]]] = DEFAULT_CATEGORIES,
    overrides: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
    """cog name (lowercased) → category name, overrides applied last."""
    lookup: Dict[str, str] = {}
    for name, _emoji, cogs in categories:
        for cog in cogs:
            lookup[cog.lower()] = name
    for cog, category in (overrides or {}).items():
        lookup[str(cog).lower()] = category
    return lookup


def is_admin_command(
    name: str,
    *,
    extra: Optional[Sequence[str]] = None,
    exclude: Optional[Sequence[str]] = None,
) -> bool:
    """Is this top-level command server configuration rather than a feature?

    True for Red's ``<thing>set`` convention (``triviaset``, ``heistset``,
    ``crackpotset``…), for ``*config`` / ``*settings``, and for the handful of
    gated groups listed by hand. ``exclude`` wins over everything, so a false
    positive can be corrected without a code change.
    """
    lowered = str(name or "").lower()
    if not lowered:
        return False
    blocked = {item.lower() for item in (exclude or ())} | ADMIN_EXCLUDE
    if lowered in blocked:
        return False
    if lowered in ADMIN_COMMANDS or lowered in {item.lower() for item in (extra or ())}:
        return True
    # "set" alone is Red's bot-settings group and is listed above; the suffix
    # rule needs a real prefix so a three-letter command cannot trip it.
    return len(lowered) > 4 and lowered.endswith(ADMIN_SUFFIXES)


def category_of(cog_name: Optional[str], lookup: Dict[str, str]) -> str:
    """Which bucket a cog belongs to. Uncategorised is a real answer, not a
    dropped command — "Other" is a visible bucket in the panel."""
    if not cog_name:
        return OTHER
    return lookup.get(str(cog_name).lower(), OTHER)


def emoji_for(
    category: str, categories: Sequence[Tuple[str, str, Sequence[str]]] = DEFAULT_CATEGORIES
) -> str:
    for name, emoji, _cogs in categories:
        if name == category:
            return emoji
    return OTHER_EMOJI


def order_categories(
    present: Sequence[str],
    categories: Sequence[Tuple[str, str, Sequence[str]]] = DEFAULT_CATEGORIES,
) -> List[str]:
    """Declared order first, then any custom category alphabetically, with
    "Other" pinned last so the tidy buckets come first."""
    declared = [name for name, _e, _c in categories if name in present]
    extra = sorted(name for name in present if name not in declared and name != OTHER)
    tail = [OTHER] if OTHER in present else []
    return declared + extra + tail


def paginate(lines: Sequence[str], limit: int = 3800) -> List[str]:
    """Pack lines into embed-sized pages, splitting only between lines.

    A single line longer than the limit is hard-split rather than dropped —
    losing a command from the help menu is worse than an ugly wrap.
    """
    pages: List[str] = []
    current = ""
    for raw in lines:
        line = str(raw)
        if len(line) > limit:
            if current:
                pages.append(current)
                current = ""
            for start in range(0, len(line), limit):
                pages.append(line[start : start + limit])
            continue
        if current and len(current) + 1 + len(line) > limit:
            pages.append(current)
            current = ""
        current = line if not current else f"{current}\n{line}"
    if current:
        pages.append(current)
    return pages or [""]


def short_doc(command_help: Optional[str], limit: int = 90) -> str:
    """The first line of a command's help, trimmed to fit a menu row."""
    text = (command_help or "").strip().split("\n")[0].strip()
    if not text:
        return "—"
    if len(text) > limit:
        return text[: limit - 1].rstrip() + "…"
    return text
