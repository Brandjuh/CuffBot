"""Split or Steal against a bot — the interrogation-room prisoner's dilemma.

Pure logic, no discord objects. The whole point of playing this alone is that
the opponent has a *personality* you can read across rounds, so the strategies
below are the classic iterated-dilemma ones rather than a coin flip. Each bot
announces which one it is only when the game ends, so a single round is still a
guess and a long game rewards paying attention.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Callable, Dict, List, Literal, Optional, Sequence, Tuple

Move = Literal["split", "steal"]

#: One round of history, from the bot's point of view.
Round = Tuple[Move, Move]  # (bot move, player move)


def payout(bot_move: Move, player_move: Move, pot: int) -> Tuple[int, int]:
    """Golden-balls payoff: ``(bot share, player share)``.

    Both split → half each. One steals → the thief takes everything. Both steal
    → the pot goes back to the precinct and nobody sees a donut.
    """
    if bot_move == "split" and player_move == "split":
        return pot // 2, pot - pot // 2
    if bot_move == "steal" and player_move == "split":
        return pot, 0
    if bot_move == "split" and player_move == "steal":
        return 0, pot
    return 0, 0


def _always_split(history: Sequence[Round], rng: random.Random) -> Move:
    return "split"


def _always_steal(history: Sequence[Round], rng: random.Random) -> Move:
    return "steal"


def _tit_for_tat(history: Sequence[Round], rng: random.Random) -> Move:
    """Splits first, then simply mirrors whatever you did last."""
    return "split" if not history else history[-1][1]


def _grudger(history: Sequence[Round], rng: random.Random) -> Move:
    """Splits until you steal once — then never trusts you again."""
    return "steal" if any(player == "steal" for _, player in history) else "split"


def _detective(history: Sequence[Round], rng: random.Random) -> Move:
    """Probes with split, steal, split, split — then punishes or exploits.

    If you never retaliated during the probe it reads you as a pushover and
    steals forever; if you did, it falls back to tit-for-tat.
    """
    probe: List[Move] = ["split", "steal", "split", "split"]
    if len(history) < len(probe):
        return probe[len(history)]
    if any(player == "steal" for _, player in history[: len(probe)]):
        return _tit_for_tat(history, rng)
    return "steal"


def _coin_flip(history: Sequence[Round], rng: random.Random) -> Move:
    return "split" if rng.random() < 0.5 else "steal"


def _copykitten(history: Sequence[Round], rng: random.Random) -> Move:
    """Forgiving tit-for-tat: only retaliates after you steal twice running."""
    if len(history) < 2:
        return "split"
    return "steal" if history[-1][1] == "steal" and history[-2][1] == "steal" else "split"


@dataclass(frozen=True)
class Strategy:
    key: str
    name: str
    #: Revealed at the end of the game, never before.
    tell: str
    decide: Callable[[Sequence[Round], random.Random], Move]


STRATEGIES: Dict[str, Strategy] = {
    strategy.key: strategy
    for strategy in (
        Strategy("saint", "The Saint", "Splits every single time. Trusting to a fault.", _always_split),
        Strategy("crook", "The Crook", "Steals every single time. No honour at all.", _always_steal),
        Strategy(
            "mirror",
            "The Mirror",
            "Splits first, then does whatever you did last round.",
            _tit_for_tat,
        ),
        Strategy(
            "grudge",
            "The Grudge",
            "Splits until you steal once — then never forgives.",
            _grudger,
        ),
        Strategy(
            "kitten",
            "The Kitten",
            "Like The Mirror, but forgives a single steal. Two in a row, and it bites.",
            _copykitten,
        ),
        Strategy(
            "detective",
            "The Detective",
            "Probes you for four rounds, then exploits you if you never fought back.",
            _detective,
        ),
        Strategy("coin", "The Coin", "Flips a coin. Genuinely unreadable.", _coin_flip),
    )
}


def random_strategy(rng: random.Random) -> Strategy:
    return rng.choice(list(STRATEGIES.values()))


@dataclass
class SplitStealGame:
    """A best-of-N interrogation against one bot."""

    strategy: Strategy
    rounds: int
    pot: int
    rng: random.Random
    history: List[Round] = None  # type: ignore[assignment]
    bot_total: int = 0
    player_total: int = 0

    def __post_init__(self):
        if self.history is None:
            self.history = []

    @property
    def finished(self) -> bool:
        return len(self.history) >= self.rounds

    @property
    def round_number(self) -> int:
        return len(self.history) + 1

    def play(self, player_move: Move) -> Tuple[Move, int, int]:
        """Resolve one round. Returns ``(bot move, bot share, player share)``.

        The bot decides from history **before** seeing this round's answer, so
        it never gets to peek — that is the whole game.
        """
        if self.finished:
            raise ValueError("This game is over")
        bot_move = self.strategy.decide(tuple(self.history), self.rng)
        bot_share, player_share = payout(bot_move, player_move, self.pot)
        self.bot_total += bot_share
        self.player_total += player_share
        self.history.append((bot_move, player_move))
        return bot_move, bot_share, player_share

    def winner(self) -> Optional[str]:
        """``"player"``, ``"bot"`` or ``None`` for a dead heat."""
        if self.player_total > self.bot_total:
            return "player"
        if self.bot_total > self.player_total:
            return "bot"
        return None
