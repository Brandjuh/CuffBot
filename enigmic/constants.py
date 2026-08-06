"""Shared constants and enumerations for the Enigmic cog.

This module is pure stdlib and must never import discord or redbot.
"""

from __future__ import annotations

from enum import Enum
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

#: Directory containing the bundled case JSON files.  The cog itself resolves
#: the same directory through ``bundled_data_path``; tools and tests use this
#: constant directly so they never need a Red import.
CASES_DIR: Path = Path(__file__).resolve().parent / "data" / "cases"

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

#: Unique identifier for redbot.core.Config.  Do not change once released.
CONFIG_IDENTIFIER: int = 0xE216_61C0_2026

#: Version of the persisted game-state schema.
GAME_SCHEMA_VERSION: int = 1

#: Version of the case JSON schema.
CASE_SCHEMA_VERSION: int = 1

# ---------------------------------------------------------------------------
# Grid limits
# ---------------------------------------------------------------------------

MIN_GRID_SIZE: int = 4
MAX_GRID_SIZE: int = 8

#: Column labels used for coordinates ("A1" = column A, row 1).
COLUMN_LETTERS: str = "ABCDEFGH"

# ---------------------------------------------------------------------------
# Solver limits
# ---------------------------------------------------------------------------

#: Default maximum number of search nodes for a single solver run.
SOLVER_NODE_LIMIT: int = 2_000_000

#: Default wall-clock limit (seconds) for a single solver run.
SOLVER_TIME_LIMIT: float = 10.0

#: Stricter budgets applied while validating imported cases so a hostile
#: case cannot stall the bot.
IMPORT_NODE_LIMIT: int = 500_000
IMPORT_TIME_LIMIT: float = 5.0

#: Maximum number of solutions enumerated when computing hints.
HINT_SOLUTION_LIMIT: int = 24

# ---------------------------------------------------------------------------
# Gameplay limits
# ---------------------------------------------------------------------------

#: Maximum number of reversible actions kept in the undo history.
UNDO_HISTORY_LIMIT: int = 50

#: Seconds a player must wait between solution submissions.
SUBMIT_COOLDOWN_SECONDS: int = 10

#: Maximum accepted size (bytes) for an imported case JSON attachment.
MAX_IMPORT_FILE_SIZE: int = 262_144  # 256 KiB

#: Interval (seconds) between background cleanup sweeps.
CLEANUP_INTERVAL_SECONDS: int = 900  # 15 minutes

#: Default per-guild settings (mirrored in Config registration).
DEFAULT_HINT_LIMIT: int = 3
DEFAULT_TIMEOUT_MINUTES: int = 1440
DEFAULT_TIMEZONE: str = "UTC"

# ---------------------------------------------------------------------------
# Enumerations
# ---------------------------------------------------------------------------


class Difficulty(str, Enum):
    """Case difficulty tiers mapped to their conventional grid sizes."""

    BEGINNER = "beginner"
    EASY = "easy"
    NORMAL = "normal"
    HARD = "hard"
    EXPERT = "expert"

    @classmethod
    def from_str(cls, value: str) -> "Difficulty | None":
        """Return the matching difficulty for ``value``, or ``None``."""
        try:
            return cls(value.lower())
        except ValueError:
            return None


#: Conventional grid size for each difficulty tier.  The engine supports any
#: size within [MIN_GRID_SIZE, MAX_GRID_SIZE] regardless of this mapping.
DIFFICULTY_SIZES: dict[Difficulty, int] = {
    Difficulty.BEGINNER: 4,
    Difficulty.EASY: 5,
    Difficulty.NORMAL: 6,
    Difficulty.HARD: 7,
    Difficulty.EXPERT: 8,
}


class Role(str, Enum):
    """Character roles within a case."""

    SUSPECT = "suspect"
    VICTIM = "victim"


class GameStatus(str, Enum):
    """Lifecycle states of an active game."""

    ACTIVE = "active"
    COMPLETED = "completed"
    ABANDONED = "abandoned"
    EXPIRED = "expired"


class GameMode(str, Enum):
    """How a game was started; daily games feed the daily leaderboard."""

    STANDARD = "standard"
    DAILY = "daily"


class FeedbackMode(str, Enum):
    """How much detail an incorrect submission reveals."""

    GENERIC = "generic"
    COUNT = "count"
    DETAILED = "detailed"


class HintLevel(int, Enum):
    """Progressive hint tiers."""

    ELIMINATION = 1
    FORCED = 2
    REVEAL = 3


class ClueType(str, Enum):
    """All supported structured clue types."""

    # Position clues
    IN_ROOM = "in_room"
    NOT_IN_ROOM = "not_in_room"
    IN_ROW = "in_row"
    NOT_IN_ROW = "not_in_row"
    IN_COLUMN = "in_column"
    NOT_IN_COLUMN = "not_in_column"
    ON_FEATURE = "on_feature"
    NOT_ON_FEATURE = "not_on_feature"

    # Character relationship clues
    BESIDE_CHARACTER = "beside_character"
    NOT_BESIDE_CHARACTER = "not_beside_character"
    NORTH_OF_CHARACTER = "north_of_character"
    SOUTH_OF_CHARACTER = "south_of_character"
    EAST_OF_CHARACTER = "east_of_character"
    WEST_OF_CHARACTER = "west_of_character"
    DIRECTLY_NORTH_OF_CHARACTER = "directly_north_of_character"
    DIRECTLY_SOUTH_OF_CHARACTER = "directly_south_of_character"
    DIRECTLY_EAST_OF_CHARACTER = "directly_east_of_character"
    DIRECTLY_WEST_OF_CHARACTER = "directly_west_of_character"
    SAME_ROOM_AS_CHARACTER = "same_room_as_character"
    DIFFERENT_ROOM_FROM_CHARACTER = "different_room_from_character"

    # Object relationship clues
    BESIDE_OBJECT = "beside_object"
    NOT_BESIDE_OBJECT = "not_beside_object"
    NORTH_OF_OBJECT = "north_of_object"
    SOUTH_OF_OBJECT = "south_of_object"
    EAST_OF_OBJECT = "east_of_object"
    WEST_OF_OBJECT = "west_of_object"
    IN_SAME_ROOM_AS_OBJECT = "in_same_room_as_object"
    NOT_IN_SAME_ROOM_AS_OBJECT = "not_in_same_room_as_object"

    # Compound clues
    ALL_OF = "all_of"
    ANY_OF = "any_of"
    EXACTLY_ONE_OF = "exactly_one_of"


#: Clue types whose parameters embed child constraints.
COMPOUND_CLUE_TYPES: frozenset[ClueType] = frozenset(
    {ClueType.ALL_OF, ClueType.ANY_OF, ClueType.EXACTLY_ONE_OF}
)
