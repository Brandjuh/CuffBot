"""Word engine for the solo party games.

Pure logic — no discord objects anywhere in this module, so every rule below is
testable with plain strings.

Two things live here:

* :class:`WordList` — the bundled dictionary, plus the trigram puzzles built
  **from** it. The original party-games cog hard-codes its list of 3-letter
  prompts, which means a prompt can turn out to have almost no solutions in the
  dictionary being used. Deriving the prompts from the word list instead makes
  every puzzle solvable by construction (``MIN_WORDS_PER_TRIGRAM`` at minimum).
* :class:`BotBrain` — the opponent. It has to be beatable, so it does not just
  grab the best word it can find: each difficulty has a hesitation delay, a
  chance to draw a blank entirely, and a preferred word-length window.
"""

from __future__ import annotations

import gzip
import random
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

#: A 3-letter prompt is only used when the dictionary holds at least this many
#: words containing it — otherwise "type a word with XYZ" is a coin flip.
MIN_WORDS_PER_TRIGRAM = 30

#: Longer than this and it is a proper noun or a chemistry term nobody types.
MAX_WORD_LENGTH = 15
MIN_WORD_LENGTH = 2


@dataclass(frozen=True)
class Difficulty:
    """How well — and how fast — a bot opponent plays."""

    key: str
    label: str
    #: Seconds the bot "thinks" before answering. Drawn uniformly.
    delay: Tuple[float, float]
    #: Chance per turn that it simply fails to come up with anything.
    blank_chance: float
    #: Preferred word length. It looks here first, then anywhere.
    length_bias: Tuple[int, int]
    #: For "most words": how many it manages per 15 seconds.
    words_per_15s: Tuple[int, int]
    #: For "longest word": it picks from the top slice of candidates by length.
    #: 1.0 = the whole field (bad), 0.02 = near-optimal play.
    long_slice: float


DIFFICULTIES: Dict[str, Difficulty] = {
    "rookie": Difficulty(
        key="rookie",
        label="Rookie",
        delay=(6.0, 13.0),
        blank_chance=0.30,
        length_bias=(3, 5),
        words_per_15s=(1, 2),
        long_slice=0.60,
    ),
    "officer": Difficulty(
        key="officer",
        label="Officer",
        delay=(3.5, 8.0),
        blank_chance=0.12,
        length_bias=(4, 7),
        words_per_15s=(2, 4),
        long_slice=0.25,
    ),
    "detective": Difficulty(
        key="detective",
        label="Detective",
        delay=(1.5, 4.0),
        blank_chance=0.03,
        length_bias=(6, 11),
        words_per_15s=(4, 7),
        long_slice=0.05,
    ),
}

DEFAULT_DIFFICULTY = "officer"


def resolve_difficulty(name: Optional[str]) -> Optional[Difficulty]:
    """Look up a difficulty by name or by unambiguous prefix."""
    if not name:
        return None
    text = name.strip().lower()
    if text in DIFFICULTIES:
        return DIFFICULTIES[text]
    hits = [d for key, d in DIFFICULTIES.items() if key.startswith(text)]
    return hits[0] if len(hits) == 1 else None


class WordList:
    """The bundled dictionary, loaded once and shared by every game.

    :meth:`load` reads and indexes ~65k words, which takes about a second on a
    Raspberry Pi — call it off the event loop (see the cog's executor use).
    """

    def __init__(self, path: Path):
        self.path = path
        self.words: Tuple[str, ...] = ()
        self.lookup: frozenset = frozenset()
        self.trigrams: Tuple[str, ...] = ()
        self.loaded = False

    def load(self) -> "WordList":
        """Read the word file and derive the puzzle trigrams. Blocking."""
        if self.loaded:
            return self
        opener = gzip.open if self.path.suffix == ".gz" else open
        with opener(self.path, "rt", encoding="utf-8") as handle:  # type: ignore[operator]
            words = [
                line
                for line in (raw.strip().lower() for raw in handle)
                if line.isalpha() and MIN_WORD_LENGTH <= len(line) <= MAX_WORD_LENGTH
            ]
        self.words = tuple(sorted(set(words)))
        self.lookup = frozenset(self.words)

        counts: Counter = Counter()
        for word in self.words:
            # A trigram is counted once per word, not once per occurrence —
            # "banana" must not make "ana" look twice as common as it is.
            for trigram in {word[i : i + 3] for i in range(len(word) - 2)}:
                counts[trigram] += 1
        self.trigrams = tuple(
            sorted(gram for gram, total in counts.items() if total >= MIN_WORDS_PER_TRIGRAM)
        )
        self.loaded = True
        return self

    def is_word(self, text: str) -> bool:
        return text.strip().lower() in self.lookup

    def random_trigram(self, rng: random.Random) -> str:
        if not self.trigrams:
            raise RuntimeError("Word list has not been loaded")
        return rng.choice(self.trigrams).upper()

    def candidates(
        self,
        chars: str,
        used: Iterable[str] = (),
        *,
        min_length: int = MIN_WORD_LENGTH,
        max_length: int = MAX_WORD_LENGTH,
    ) -> List[str]:
        """Every unused word containing ``chars`` within the length window."""
        needle = chars.strip().lower()
        skip = {w.lower() for w in used}
        return [
            word
            for word in self.words
            if needle in word
            and min_length <= len(word) <= max_length
            and word not in skip
        ]


@dataclass
class BotBrain:
    """A bot opponent's word-finding, tuned by :class:`Difficulty`."""

    words: WordList
    difficulty: Difficulty
    rng: random.Random = field(default_factory=random.Random)

    def think_time(self) -> float:
        return self.rng.uniform(*self.difficulty.delay)

    def draws_a_blank(self) -> bool:
        return self.rng.random() < self.difficulty.blank_chance

    def find(self, chars: str, used: Iterable[str] = ()) -> Optional[str]:
        """A word for this prompt, biased towards the difficulty's length window.

        Returns ``None`` when the bot draws a blank or the prompt genuinely has
        no answer left — the caller treats both the same way.
        """
        if self.draws_a_blank():
            return None
        pool = self.words.candidates(chars, used)
        if not pool:
            return None
        low, high = self.difficulty.length_bias
        preferred = [word for word in pool if low <= len(word) <= high]
        return self.rng.choice(preferred or pool)

    def find_longest(self, chars: str, used: Iterable[str] = ()) -> Optional[str]:
        """A deliberately long word — the answer for the "longest word" round.

        It picks randomly from the top ``long_slice`` of the field by length, so
        a Detective is nearly optimal while a Rookie often leaves a longer word
        on the table.
        """
        if self.draws_a_blank():
            return None
        pool = self.words.candidates(chars, used)
        if not pool:
            return None
        pool.sort(key=len, reverse=True)
        cut = max(1, int(len(pool) * self.difficulty.long_slice))
        return self.rng.choice(pool[:cut])

    def find_many(self, chars: str, seconds: float, used: Iterable[str] = ()) -> List[str]:
        """The batch of words it manages within a time window."""
        low, high = self.difficulty.words_per_15s
        target = round(self.rng.randint(low, high) * (seconds / 15.0))
        if target <= 0:
            return []
        found: List[str] = []
        skip = {w.lower() for w in used}
        for _ in range(target):
            word = self.find(chars, skip)
            if word is None:
                # A blank here means it stopped typing, not that it is out of
                # words — stop the batch rather than retry to a fixed count.
                break
            found.append(word)
            skip.add(word)
        return found


#: Bot opponents get precinct names — they read as colleagues in the transcript
#: rather than as "Bot 1", and every one of them is clearly not a real member.
OPPONENT_NAMES: Sequence[str] = (
    "Officer Ramirez",
    "Sgt. Doyle",
    "Det. Okonkwo",
    "Officer Brandt",
    "Cadet Pilkington",
    "Det. Vasquez",
    "Officer Nakamura",
    "Sgt. Abubakar",
)


def pick_opponent_names(count: int, rng: random.Random) -> List[str]:
    """Distinct opponent names, numbered if someone ever asks for more than we
    have on the roster."""
    roster = list(OPPONENT_NAMES)
    rng.shuffle(roster)
    if count <= len(roster):
        return roster[:count]
    extra = [f"Officer #{i}" for i in range(1, count - len(roster) + 1)]
    return roster + extra
