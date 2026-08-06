"""Custom exceptions for the Enigmic cog.

Every exception carries a user-presentable English message so command and
view code can relay ``str(exc)`` directly without leaking internals.
"""

from __future__ import annotations


class EnigmicError(Exception):
    """Base class for all Enigmic-specific errors."""


class CaseNotFound(EnigmicError):
    """Raised when a requested case ID does not exist or is disabled."""


class InvalidCoordinate(EnigmicError):
    """Raised when a coordinate string cannot be parsed or is off the board."""


class InvalidMove(EnigmicError):
    """Raised when a placement or mark violates the movement rules."""


class GameNotFound(EnigmicError):
    """Raised when the player has no active game."""


class GameAlreadyActive(EnigmicError):
    """Raised when starting a game while another one is still active."""


class UnauthorizedGameAction(EnigmicError):
    """Raised when a user interacts with a game they do not own."""


class CaseValidationError(EnigmicError):
    """Raised when a case definition fails validation."""


class SolverTimeout(EnigmicError):
    """Raised when the solver exceeds its node or time budget."""


class AmbiguousCharacter(EnigmicError):
    """Raised when a partial character name matches more than one character."""
