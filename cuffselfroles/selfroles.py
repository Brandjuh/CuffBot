"""Pure self-roles logic — port of the Node module's ``lib/selfroles.js``.

The self-assignable roles are not a stored list: they are read from the guild's
own role list, namely everything positioned *under* a header role called
``self-roles``, stopping at the next divider. That means an admin adds a self
role by dragging it into the section in Discord's own role editor, and the
list follows.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Mapping, Optional, Sequence

DEFAULT_HEADER_NAME = "self-roles"

#: Discord allows 5 buttons × 5 rows on one message.
BUTTONS_PER_MESSAGE = 25
#: Five full messages. A sanity cap, not a Discord limit.
MAX_SELF_ROLES = 125

#: A role button's label: Discord rejects anything over 80 characters.
LABEL_LIMIT = 80

_DIVIDER_BRACKET = re.compile(r"^[\s\W]*\[[^\]]+\][\s\W]*$")
_DIVIDER_RULE = re.compile(r"[▬━─═_=~-]{2,}")
_TRIM = re.compile(r"^[\s\W]+|[\s\W]+$")


def is_section_divider(name: Any) -> bool:
    """Does this role name look like a divider between role-list sections?"""
    if not isinstance(name, str):
        return False
    return bool(_DIVIDER_BRACKET.match(name) or _DIVIDER_RULE.search(re.sub(r"\s", "", name)))


def is_selfroles_header(name: Any, header_name: str = DEFAULT_HEADER_NAME) -> bool:
    """Is this the role that marks the top of the self-roles section?

    Decoration is ignored, so ``[ self-roles ]`` and ``── self-roles ──``
    both count — admins decorate section headers and should not have to think
    about it.
    """
    if not isinstance(name, str):
        return False
    return _TRIM.sub("", name.strip()).lower() == str(header_name).lower()


def select_self_roles(
    roles_desc: Sequence[Mapping[str, Any]],
    *,
    header_name: str = DEFAULT_HEADER_NAME,
    cap: int = MAX_SELF_ROLES,
) -> Dict[str, Any]:
    """Pick the self-assignable roles out of the guild's role list.

    ``roles_desc`` is every role, highest position first, as
    ``{id, name, managed, elevated}``. Returns the roles plus everything that
    was skipped and why — an admin who dragged a role in and saw nothing
    happen deserves to be told which rule caught it.
    """
    header_index = next(
        (i for i, role in enumerate(roles_desc) if is_selfroles_header(role.get("name"), header_name)),
        -1,
    )
    if header_index < 0:
        return {"header_found": False, "header_role_id": None, "roles": [], "skipped": []}

    roles: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []
    for role in list(roles_desc)[header_index + 1 :]:
        name = role.get("name")
        if name == "@everyone":
            continue
        if is_section_divider(name):
            break  # the next section of the role list
        if role.get("managed"):
            skipped.append({"id": role["id"], "name": name, "reason": "managed by an integration"})
            continue
        if role.get("elevated"):
            # A self-assignable moderator role is a security hole, not a feature.
            skipped.append({"id": role["id"], "name": name, "reason": "has elevated permissions"})
            continue
        if len(roles) >= cap:
            skipped.append({"id": role["id"], "name": name, "reason": f"over the {cap}-role cap"})
            continue
        roles.append({"id": role["id"], "name": name})

    return {
        "header_found": True,
        "header_role_id": roles_desc[header_index]["id"],
        "roles": roles,
        "skipped": skipped,
    }


def render_lines(
    roles: Sequence[Mapping[str, Any]], info: Optional[Mapping[str, Mapping[str, str]]] = None
) -> List[str]:
    """One line per role: emoji, bold name, then the admin's info text."""
    info = info or {}
    lines = []
    for role in roles:
        extra = info.get(str(role["id"])) or {}
        emoji = f"{extra['emoji']} " if extra.get("emoji") else ""
        text = f" — {extra['text']}" if extra.get("text") else ""
        lines.append(f"{emoji}**{role['name']}**{text}")
    return lines


def button_label(name: Any) -> str:
    """Clamp a role name to a valid button label."""
    text = str(name or "").strip() or "role"
    return text if len(text) <= LABEL_LIMIT else text[: LABEL_LIMIT - 1] + "…"


def chunk(roles: Sequence[Any], size: int = BUTTONS_PER_MESSAGE) -> List[List[Any]]:
    """Split the roster into per-message chunks.

    Always yields at least one (possibly empty) chunk, so an empty section
    still produces the "no self roles found" message rather than nothing.
    """
    if not roles:
        return [[]]
    return [list(roles[i : i + size]) for i in range(0, len(roles), size)]
