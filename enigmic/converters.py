"""Argument resolution helpers for commands and views.

The resolvers here are pure functions (no discord imports) so they can be
unit tested; command callbacks call them and relay the error messages.
"""

from __future__ import annotations

from .errors import AmbiguousCharacter, InvalidMove
from .models import Case, Character


def resolve_character(case: Case, query: str) -> Character:
    """Find a character by ID, full name, short name, or unique partial name.

    Matching is case-insensitive.  Raises :class:`InvalidMove` when nothing
    matches and :class:`AmbiguousCharacter` when a partial query matches more
    than one character.
    """
    text = (query or "").strip().lower()
    if not text:
        raise InvalidMove("Please name a character.")

    for character in case.characters:
        if text in (character.id.lower(), character.name.lower(),
                    character.short_name.lower(), character.symbol.lower()):
            return character

    partial = [
        character
        for character in case.characters
        if text in character.name.lower()
        or text in character.short_name.lower()
        or text in character.id.lower()
    ]
    if len(partial) == 1:
        return partial[0]
    if len(partial) > 1:
        names = ", ".join(c.name for c in partial)
        raise AmbiguousCharacter(
            f"'{query}' matches more than one character: {names}. "
            f"Please be more specific."
        )
    names = ", ".join(c.short_name for c in case.characters)
    raise InvalidMove(
        f"No character in this case matches '{query}'. "
        f"The characters are: {names}."
    )
