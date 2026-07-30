"""CuffSolo — play the precinct's multiplayer games on your own.

Some games in this bot need a room full of people. On a quiet night that means
they cannot be played at all. This cog adds single-player versions with bot
opponents:

* **Word games** (bomb party, fastest, longest, most) — the same four games the
  party-games cog runs, but against precinct officers who type at a believable
  speed and are far from perfect.
* **Split or Steal** — the interrogation-room dilemma against a bot with an
  actual personality, revealed only once the game is over.

The opponents are tuned to be *beatable*: every difficulty has a hesitation
delay, a chance to draw a blank, and a preferred word length. A Rookie is a
warm-up; a Detective will take the round off you if you dawdle.

Not covered: Mafia. A social-deduction game against scripted bots is a
crossword with the answers printed underneath — see the README.
"""

import asyncio
import logging
import random
from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence, Tuple

import discord
from redbot.core import Config, bank, checks, commands, errors
from redbot.core.bot import Red
from redbot.core.data_manager import bundled_data_path

from .splitsteal import Move, SplitStealGame, random_strategy
from .words import (
    DEFAULT_DIFFICULTY,
    DIFFICULTIES,
    BotBrain,
    Difficulty,
    WordList,
    pick_opponent_names,
    resolve_difficulty,
)

log = logging.getLogger("red.cuff-cogs.cuffsolo")

SOLO_COLOR = 0x3B88C3
WIN_COLOR = 0x57F287
LOSE_COLOR = 0xED4245
ERROR_COLOR = 0xED4245

DEFAULT_ANSWER_TIME = 12  # bomb party / turn rounds
DEFAULT_ROUND_TIME = 20  # fastest / longest / most rounds

#: Hard ceiling on a single game, so a forgotten game cannot hold a channel.
MAX_ROUNDS = 40


@dataclass
class Contestant:
    """A player in a word game — you, or one of the precinct's finest."""

    name: str
    is_bot: bool
    member: Optional[discord.Member] = None
    brain: Optional[BotBrain] = None
    score: int = 0
    lives: int = 0

    @property
    def label(self) -> str:
        """How the contestant reads in an embed. Bots never get a mention."""
        return self.member.mention if self.member is not None else f"**{self.name}**"

    @property
    def plain(self) -> str:
        return self.member.display_name if self.member is not None else self.name


class CuffSolo(commands.Cog):
    """Solo mode: play the precinct's multiplayer games against bot opponents."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175013, force_registration=True)
        self.config.register_guild(
            difficulty=DEFAULT_DIFFICULTY,
            opponents=1,
            answer_time=DEFAULT_ANSWER_TIME,
            round_time=DEFAULT_ROUND_TIME,
            #: Bank prize for winning. 0 = no payout, which is the default:
            #: a game you can play alone on repeat is an obvious money printer.
            payout=0,
        )
        self.words = WordList(bundled_data_path(self) / "words_en.txt.gz")
        self._words_lock = asyncio.Lock()
        #: channel id -> game name, so two games cannot share a channel.
        self.active: Dict[int, str] = {}
        self.rng = random.Random()

    async def red_delete_data_for_user(self, **kwargs):
        """Nothing to delete — no scores or history are stored."""
        return

    def cog_unload(self):
        self.active.clear()

    # ------------------------------------------------------------------
    # Shared plumbing
    # ------------------------------------------------------------------

    async def ensure_words(self) -> WordList:
        """Load the dictionary once, off the event loop.

        Indexing 65k words takes about a second on a Pi — long enough to stall
        every other cog if it ran here.
        """
        async with self._words_lock:
            if not self.words.loaded:
                await self.bot.loop.run_in_executor(None, self.words.load)
        return self.words

    async def build_contestants(
        self, ctx: commands.Context, difficulty: Difficulty, count: int
    ) -> List[Contestant]:
        """You plus ``count`` bots, in a random turn order."""
        names = pick_opponent_names(count, self.rng)
        field_: List[Contestant] = [
            Contestant(name=ctx.author.display_name, is_bot=False, member=ctx.author)
        ]
        for name in names:
            field_.append(
                Contestant(
                    name=name,
                    is_bot=True,
                    brain=BotBrain(self.words, difficulty, random.Random(self.rng.random())),
                )
            )
        self.rng.shuffle(field_)
        return field_

    def embed(self, title: str, description: str = "", color: int = SOLO_COLOR) -> discord.Embed:
        return discord.Embed(color=color, title=title, description=description)

    async def send_error(self, ctx: commands.Context, description: str, *, title: str = "🚫 Can't start") -> None:
        await ctx.send(
            embed=self.embed(title, description, ERROR_COLOR),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    async def claim_channel(self, ctx: commands.Context, game: str) -> bool:
        """One game per channel. Returns False (and complains) if busy."""
        running = self.active.get(ctx.channel.id)
        if running:
            await self.send_error(
                ctx,
                f"A game of **{running}** is already running in this channel. "
                "Finish it, or start yours in a thread.",
                title="🚫 Channel busy",
            )
            return False
        self.active[ctx.channel.id] = game
        return True

    async def settings_for(self, ctx: commands.Context, difficulty_arg: Optional[str]):
        """Resolve the difficulty/opponents/timers for this game."""
        conf = await self.config.guild(ctx.guild).all()
        difficulty = resolve_difficulty(difficulty_arg) or resolve_difficulty(conf["difficulty"])
        if difficulty is None:
            difficulty = DIFFICULTIES[DEFAULT_DIFFICULTY]
        return difficulty, conf

    async def award(self, ctx: commands.Context, conf: dict, won: bool) -> str:
        """Pay the configured prize on a win. Returns a line for the embed."""
        payout = int(conf.get("payout") or 0)
        if payout <= 0 or not won:
            return ""
        try:
            await bank.deposit_credits(ctx.author, payout)
        except errors.BalanceTooHigh as error:
            await bank.set_balance(ctx.author, error.max_balance)
        except Exception:
            log.warning("Solo: payout failed for %s", ctx.author.id, exc_info=True)
            return ""
        currency = await bank.get_currency_name(ctx.guild)
        return f"\n\n💰 Prize: **{payout:,} {currency}**"

    # ------------------------------------------------------------------
    # Answer collection
    # ------------------------------------------------------------------

    async def wait_for_word(
        self,
        ctx: commands.Context,
        chars: str,
        used: set,
        seconds: float,
    ) -> Optional[discord.Message]:
        """Wait for the author to type a valid word, within ``seconds``.

        A wrong guess is marked ❌ and does **not** end the turn — you keep the
        rest of your time. Silently ignoring bad words (what the original party
        games do) reads as the bot being broken.
        """
        loop = self.bot.loop
        deadline = loop.time() + seconds
        needle = chars.lower()
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return None
            try:
                message = await self.bot.wait_for(
                    "message",
                    timeout=remaining,
                    check=lambda m: m.channel == ctx.channel and m.author == ctx.author,
                )
            except asyncio.TimeoutError:
                return None
            word = message.content.strip().lower()
            if (
                needle in word
                and word not in used
                and self.words.is_word(word)
            ):
                try:
                    await message.add_reaction("✅")
                except discord.HTTPException:
                    pass
                return message
            try:
                await message.add_reaction("❌")
            except discord.HTTPException:
                pass

    async def collect_words(
        self, ctx: commands.Context, chars: str, used: set, seconds: float
    ) -> List[str]:
        """Every valid word the author types inside the window."""
        loop = self.bot.loop
        deadline = loop.time() + seconds
        found: List[str] = []
        seen = set(used)
        needle = chars.lower()
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                return found
            try:
                message = await self.bot.wait_for(
                    "message",
                    timeout=remaining,
                    check=lambda m: m.channel == ctx.channel and m.author == ctx.author,
                )
            except asyncio.TimeoutError:
                return found
            word = message.content.strip().lower()
            ok = needle in word and word not in seen and self.words.is_word(word)
            try:
                await message.add_reaction("✅" if ok else "❌")
            except discord.HTTPException:
                pass
            if ok:
                found.append(word)
                seen.add(word)

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @commands.guild_only()
    @commands.group(name="solo", invoke_without_command=True)
    async def solo(self, ctx: commands.Context):
        """Play the precinct's multiplayer games on your own."""
        difficulty, conf = await self.settings_for(ctx, None)
        embed = self.embed(
            "🕹️ Solo Mode",
            "Nobody around? Play against the precinct instead. Every game below works "
            "with exactly one human — you.",
        )
        embed.add_field(
            name="Word games",
            value=(
                f"`{ctx.clean_prefix}solo bomb` — bomb party, lose a life when you blank\n"
                f"`{ctx.clean_prefix}solo fast` — first valid word takes the point\n"
                f"`{ctx.clean_prefix}solo long` — longest word takes the point\n"
                f"`{ctx.clean_prefix}solo most` — most words takes the point\n"
                f"`{ctx.clean_prefix}solo mix` — all three, at random"
            ),
            inline=False,
        )
        embed.add_field(
            name="Interrogation",
            value=(
                f"`{ctx.clean_prefix}solo splitsteal [rounds]` — split or steal against a bot "
                "with a personality you have to read"
            ),
            inline=False,
        )
        embed.add_field(name="Difficulty", value=f"**{difficulty.label}**", inline=True)
        embed.add_field(name="Opponents", value=f"**{conf['opponents']}**", inline=True)
        payout = int(conf["payout"] or 0)
        if payout > 0:
            currency = await bank.get_currency_name(ctx.guild)
            embed.add_field(name="Prize", value=f"**{payout:,} {currency}**", inline=True)
        else:
            embed.add_field(name="Prize", value="none", inline=True)
        embed.set_footer(
            text=f"Every game takes an optional difficulty: "
            f"{', '.join(DIFFICULTIES)} · {ctx.clean_prefix}soloset to configure"
        )
        await ctx.send(embed=embed)

    @solo.command(name="difficulties", aliases=["levels"])
    async def solo_difficulties(self, ctx: commands.Context):
        """What each difficulty actually does."""
        embed = self.embed("🎚️ Difficulties", "Pass one to any game, e.g. `solo fast 5 detective`.")
        for difficulty in DIFFICULTIES.values():
            embed.add_field(
                name=difficulty.label,
                value=(
                    f"Answers in **{difficulty.delay[0]:.0f}–{difficulty.delay[1]:.0f}s**\n"
                    f"Blanks **{difficulty.blank_chance:.0%}** of turns\n"
                    f"Prefers **{difficulty.length_bias[0]}–{difficulty.length_bias[1]}** letter words"
                ),
                inline=True,
            )
        await ctx.send(embed=embed)

    # -- bomb party ----------------------------------------------------

    @solo.command(name="bomb", aliases=["bombparty"])
    async def solo_bomb(
        self, ctx: commands.Context, lives: int = 3, difficulty: Optional[str] = None
    ):
        """Bomb party against the precinct. Blank on your turn and you lose a life."""
        if not 1 <= lives <= 5:
            return await self.send_error(ctx, "Pick between **1** and **5** lives.")
        level, conf = await self.settings_for(ctx, difficulty)
        if difficulty and resolve_difficulty(difficulty) is None:
            return await self.send_error(
                ctx, f"`{difficulty}` is not a difficulty. Pick: {', '.join(DIFFICULTIES)}."
            )
        if not await self.claim_channel(ctx, "Bomb Party"):
            return
        try:
            await self.run_bomb(ctx, level, conf, lives)
        finally:
            self.active.pop(ctx.channel.id, None)

    async def run_bomb(self, ctx: commands.Context, level: Difficulty, conf: dict, lives: int):
        await self.ensure_words()
        field_ = await self.build_contestants(ctx, level, int(conf["opponents"]))
        for contestant in field_:
            contestant.lives = lives
        answer_time = int(conf["answer_time"])

        embed = self.embed(
            "💣 Bomb Party",
            f"Type a word containing the letters shown, before the bomb goes off "
            f"(**{answer_time}s**). Blank and you lose a life.\n\n"
            + "\n".join(f"{c.label} — {'❤️' * c.lives}" for c in field_),
        )
        embed.set_footer(text=f"Difficulty: {level.label} · words cannot be reused")
        await ctx.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())
        await asyncio.sleep(3)

        used: set = set()
        turns = 0
        while sum(1 for c in field_ if c.lives > 0) > 1 and turns < MAX_ROUNDS * len(field_):
            for contestant in field_:
                if contestant.lives <= 0:
                    continue
                if sum(1 for c in field_ if c.lives > 0) <= 1:
                    break
                turns += 1
                chars = self.words.random_trigram(self.rng)
                survived = await self.bomb_turn(ctx, contestant, chars, used, answer_time, level)
                if not survived:
                    contestant.lives -= 1
                    note = (
                        f"💥 {contestant.label} is **out of the game!**"
                        if contestant.lives == 0
                        else f"💥 {contestant.label} loses a life — {'❤️' * contestant.lives} left."
                    )
                    await ctx.send(
                        embed=self.embed("Bomb!", note, LOSE_COLOR),
                        allowed_mentions=discord.AllowedMentions.none(),
                    )
                await asyncio.sleep(2)

        alive = [c for c in field_ if c.lives > 0]
        winner = alive[0] if len(alive) == 1 else None
        won = winner is not None and not winner.is_bot
        prize = await self.award(ctx, conf, won)
        title = "🏆 You win!" if won else ("🚔 The precinct wins" if winner else "🤝 Nobody left standing")
        body = (
            f"{winner.label} is the last one standing." if winner else "Everyone went out together."
        )
        await ctx.send(
            embed=self.embed(title, body + prize, WIN_COLOR if won else LOSE_COLOR),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    async def bomb_turn(
        self,
        ctx: commands.Context,
        contestant: Contestant,
        chars: str,
        used: set,
        answer_time: int,
        level: Difficulty,
    ) -> bool:
        """One player's turn. True if they answered in time."""
        if contestant.is_bot:
            assert contestant.brain is not None
            await ctx.send(
                embed=self.embed("💣", f"{contestant.label}, type a word containing **{chars}**")
            )
            # The bot never gets more time than a human would.
            think = min(contestant.brain.think_time(), answer_time)
            await asyncio.sleep(think)
            word = contestant.brain.find(chars, used)
            if word is None:
                return False
            used.add(word)
            await ctx.send(f"**{contestant.name}:** {word}")
            return True

        await ctx.send(
            embed=self.embed("💣", f"{contestant.label}, type a word containing **{chars}**"),
            allowed_mentions=discord.AllowedMentions(users=True),
        )
        message = await self.wait_for_word(ctx, chars, used, answer_time)
        if message is None:
            return False
        used.add(message.content.strip().lower())
        return True

    # -- point games ---------------------------------------------------

    @solo.command(name="fast", aliases=["fastest"])
    async def solo_fast(
        self, ctx: commands.Context, points: int = 5, difficulty: Optional[str] = None
    ):
        """Race the precinct: first valid word takes the point."""
        await self.point_game(ctx, "fast", points, difficulty)

    @solo.command(name="long", aliases=["longest"])
    async def solo_long(
        self, ctx: commands.Context, points: int = 5, difficulty: Optional[str] = None
    ):
        """Longest word takes the point."""
        await self.point_game(ctx, "long", points, difficulty)

    @solo.command(name="most")
    async def solo_most(
        self, ctx: commands.Context, points: int = 5, difficulty: Optional[str] = None
    ):
        """Most words inside the time limit takes the point."""
        await self.point_game(ctx, "most", points, difficulty)

    @solo.command(name="mix")
    async def solo_mix(
        self, ctx: commands.Context, points: int = 5, difficulty: Optional[str] = None
    ):
        """A random mixture of the three point games."""
        await self.point_game(ctx, "mix", points, difficulty)

    NAMES = {
        "fast": "Fastest Word",
        "long": "Longest Word",
        "most": "Most Words",
        "mix": "Mixed Bag",
    }

    async def point_game(
        self, ctx: commands.Context, kind: str, points: int, difficulty: Optional[str]
    ):
        if not 1 <= points <= 20:
            return await self.send_error(ctx, "Play to between **1** and **20** points.")
        if difficulty and resolve_difficulty(difficulty) is None:
            return await self.send_error(
                ctx, f"`{difficulty}` is not a difficulty. Pick: {', '.join(DIFFICULTIES)}."
            )
        level, conf = await self.settings_for(ctx, difficulty)
        if not await self.claim_channel(ctx, self.NAMES[kind]):
            return
        try:
            await self.run_points(ctx, kind, level, conf, points)
        finally:
            self.active.pop(ctx.channel.id, None)

    async def run_points(
        self, ctx: commands.Context, kind: str, level: Difficulty, conf: dict, points: int
    ):
        await self.ensure_words()
        field_ = await self.build_contestants(ctx, level, int(conf["opponents"]))
        round_time = int(conf["round_time"])

        rules = {
            "fast": "First valid word takes the point.",
            "long": "Longest valid word takes the point — ties go to you.",
            "most": "Most valid words takes the point.",
            "mix": "A different game every round.",
        }[kind]
        embed = self.embed(
            f"🕹️ {self.NAMES[kind]}",
            f"{rules}\nFirst to **{points}** points wins. You have **{round_time}s** a round.\n\n"
            + "\n".join(f"{c.label}" for c in field_),
        )
        embed.set_footer(text=f"Difficulty: {level.label} · words cannot be reused")
        await ctx.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())
        await asyncio.sleep(3)

        used: set = set()
        blanks = 0
        for _round in range(MAX_ROUNDS):
            this_kind = self.rng.choice(["fast", "long", "most"]) if kind == "mix" else kind
            chars = self.words.random_trigram(self.rng)
            runner = {
                "fast": self.round_fast,
                "long": self.round_long,
                "most": self.round_most,
            }[this_kind]
            winner = await runner(ctx, field_, chars, used, round_time)

            if winner is None:
                blanks += 1
                await ctx.send(
                    embed=self.embed("😴 Nobody scored", "Not a single word that round.")
                )
                if blanks >= 3:
                    await ctx.send(
                        embed=self.embed(
                            "🚪 Game abandoned", "Three empty rounds in a row — shutting it down."
                        )
                    )
                    return
            else:
                blanks = 0
                winner.score += 1
                await ctx.send(
                    embed=self.embed(
                        "Point!",
                        f"{winner.label} takes it — **{winner.score}/{points}**\n\n"
                        + self.scoreboard(field_),
                        WIN_COLOR if not winner.is_bot else SOLO_COLOR,
                    ),
                    allowed_mentions=discord.AllowedMentions.none(),
                )
                if winner.score >= points:
                    won = not winner.is_bot
                    prize = await self.award(ctx, conf, won)
                    await ctx.send(
                        embed=self.embed(
                            "🏆 You win!" if won else "🚔 The precinct wins",
                            f"{winner.label} reaches **{points}** points.\n\n"
                            + self.scoreboard(field_)
                            + prize,
                            WIN_COLOR if won else LOSE_COLOR,
                        ),
                        allowed_mentions=discord.AllowedMentions.none(),
                    )
                    return
            await asyncio.sleep(3)

        await ctx.send(
            embed=self.embed(
                "🛑 Round limit reached",
                f"That is {MAX_ROUNDS} rounds — calling it here.\n\n" + self.scoreboard(field_),
            ),
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @staticmethod
    def scoreboard(field_: Sequence[Contestant]) -> str:
        rows = sorted(field_, key=lambda c: c.score, reverse=True)
        return "\n".join(f"`{c.score}` {c.label}" for c in rows)

    async def round_fast(
        self, ctx: commands.Context, field_: List[Contestant], chars: str, used: set, seconds: int
    ) -> Optional[Contestant]:
        """A race. The first bot's answer time is the human's real deadline."""
        entries: List[Tuple[float, Contestant, str]] = []
        for contestant in field_:
            if not contestant.is_bot or contestant.brain is None:
                continue
            word = contestant.brain.find(chars, used)
            if word is not None:
                entries.append((contestant.brain.think_time(), contestant, word))
        entries.sort(key=lambda entry: entry[0])

        cutoff = min(entries[0][0], seconds) if entries else seconds
        await ctx.send(
            embed=self.embed(
                "⚡ Fastest word",
                f"First to type a word containing **{chars}**",
            )
        )
        message = await self.wait_for_word(ctx, chars, used, cutoff)
        if message is not None:
            used.add(message.content.strip().lower())
            return next(c for c in field_ if not c.is_bot)
        if not entries:
            return None
        _delay, bot, word = entries[0]
        used.add(word)
        await ctx.send(f"**{bot.name}:** {word}")
        return bot

    async def round_long(
        self, ctx: commands.Context, field_: List[Contestant], chars: str, used: set, seconds: int
    ) -> Optional[Contestant]:
        await ctx.send(
            embed=self.embed(
                "📏 Longest word",
                f"You have **{seconds}s** to type the longest word containing **{chars}**. "
                "Keep typing — only your best one counts.",
            )
        )
        mine = await self.collect_words(ctx, chars, used, seconds)
        best_human = max(mine, key=len) if mine else None

        best: Optional[Tuple[Contestant, str]] = None
        for contestant in field_:
            if not contestant.is_bot or contestant.brain is None:
                continue
            word = contestant.brain.find_longest(chars, used)
            if word is None:
                continue
            await ctx.send(f"**{contestant.name}:** {word} ({len(word)})")
            if best is None or len(word) > len(best[1]):
                best = (contestant, word)

        human = next(c for c in field_ if not c.is_bot)
        # Ties go to the human: they typed theirs live, the bot looked it up.
        if best_human is not None and (best is None or len(best_human) >= len(best[1])):
            used.add(best_human)
            await ctx.send(
                embed=self.embed("📏 Best word", f"{human.label} — **{best_human}** ({len(best_human)})"),
                allowed_mentions=discord.AllowedMentions.none(),
            )
            return human
        if best is None:
            return None
        used.add(best[1])
        return best[0]

    async def round_most(
        self, ctx: commands.Context, field_: List[Contestant], chars: str, used: set, seconds: int
    ) -> Optional[Contestant]:
        await ctx.send(
            embed=self.embed(
                "🧾 Most words",
                f"You have **{seconds}s** to type as many words containing **{chars}** as you can.",
            )
        )
        mine = await self.collect_words(ctx, chars, used, seconds)
        used.update(mine)

        tally: List[Tuple[Contestant, int]] = [(next(c for c in field_ if not c.is_bot), len(mine))]
        for contestant in field_:
            if not contestant.is_bot or contestant.brain is None:
                continue
            words = contestant.brain.find_many(chars, seconds, used)
            used.update(words)
            tally.append((contestant, len(words)))
            if words:
                await ctx.send(f"**{contestant.name}:** {', '.join(words)}")

        tally.sort(key=lambda row: row[1], reverse=True)
        await ctx.send(
            embed=self.embed(
                "🧾 Words found",
                "\n".join(f"`{count}` {c.label}" for c, count in tally),
            ),
            allowed_mentions=discord.AllowedMentions.none(),
        )
        if tally[0][1] == 0:
            return None
        leaders = [row for row in tally if row[1] == tally[0][1]]
        if len(leaders) > 1:
            await ctx.send(embed=self.embed("🤝 Tie", "Nobody takes the point."))
            return None
        return tally[0][0]

    # -- split or steal ------------------------------------------------

    @solo.command(name="splitsteal", aliases=["split", "sos"])
    async def solo_splitsteal(self, ctx: commands.Context, rounds: int = 5):
        """Split or Steal against a bot whose personality you have to read."""
        if not 1 <= rounds <= 15:
            return await self.send_error(ctx, "Play between **1** and **15** rounds.")
        if not await self.claim_channel(ctx, "Split or Steal"):
            return
        try:
            conf = await self.config.guild(ctx.guild).all()
            game = SplitStealGame(
                strategy=random_strategy(self.rng),
                rounds=rounds,
                pot=100,
                rng=random.Random(self.rng.random()),
            )
            view = SplitStealView(self, ctx, game, conf)
            view.message = await ctx.send(embed=view.build_embed(), view=view)
            await view.wait()
        finally:
            self.active.pop(ctx.channel.id, None)

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    @commands.guild_only()
    @commands.group(name="soloset", invoke_without_command=True)
    @checks.admin_or_permissions(manage_guild=True)
    async def soloset(self, ctx: commands.Context):
        """Settings for solo mode."""
        await ctx.send_help()

    @soloset.command(name="difficulty")
    async def soloset_difficulty(self, ctx: commands.Context, level: str):
        """Default difficulty for bot opponents."""
        difficulty = resolve_difficulty(level)
        if difficulty is None:
            return await self.send_error(
                ctx, f"`{level}` is not a difficulty. Pick: {', '.join(DIFFICULTIES)}.",
                title="🚫 Unknown difficulty",
            )
        await self.config.guild(ctx.guild).difficulty.set(difficulty.key)
        await ctx.send(
            embed=self.embed(
                "✅ Difficulty set", f"Bot opponents play at **{difficulty.label}**.", WIN_COLOR
            )
        )

    @soloset.command(name="opponents", aliases=["bots"])
    async def soloset_opponents(self, ctx: commands.Context, count: int):
        """How many bot opponents join a word game (1–4)."""
        if not 1 <= count <= 4:
            return await self.send_error(ctx, "Pick between **1** and **4** opponents.",
                                         title="🚫 Out of range")
        await self.config.guild(ctx.guild).opponents.set(count)
        await ctx.send(
            embed=self.embed("✅ Opponents set", f"Word games run with **{count}** bot(s).", WIN_COLOR)
        )

    @soloset.command(name="time")
    async def soloset_time(self, ctx: commands.Context, answer: int, round_: Optional[int] = None):
        """Seconds for a bomb-party turn, and for a timed round."""
        round_ = round_ if round_ is not None else answer
        if not 5 <= answer <= 60 or not 5 <= round_ <= 60:
            return await self.send_error(ctx, "Both times must be between **5** and **60** seconds.",
                                         title="🚫 Out of range")
        await self.config.guild(ctx.guild).answer_time.set(answer)
        await self.config.guild(ctx.guild).round_time.set(round_)
        await ctx.send(
            embed=self.embed(
                "✅ Timers set",
                f"Bomb-party turn: **{answer}s**\nTimed round: **{round_}s**",
                WIN_COLOR,
            )
        )

    @soloset.command(name="payout", aliases=["prize"])
    @bank.is_owner_if_bank_global()
    async def soloset_payout(self, ctx: commands.Context, amount: int):
        """Bank prize for winning a solo game (0 = off).

        Off by default on purpose: a game you can play alone, on repeat, with a
        payout is a money printer.
        """
        if amount < 0:
            return await self.send_error(ctx, "A negative prize is not a prize.",
                                         title="🚫 Bad amount")
        await self.config.guild(ctx.guild).payout.set(amount)
        if amount == 0:
            return await ctx.send(
                embed=self.embed("✅ Prize off", "Solo games pay out nothing.", WIN_COLOR)
            )
        currency = await bank.get_currency_name(ctx.guild)
        await ctx.send(
            embed=self.embed(
                "✅ Prize set",
                f"Winning a solo game pays **{amount:,} {currency}**.\n\n"
                "⚠️ Solo games can be replayed on demand — keep this small.",
                WIN_COLOR,
            )
        )


class SplitStealView(discord.ui.View):
    """The two buttons, plus the running tally, for one Split or Steal game."""

    def __init__(self, cog: CuffSolo, ctx: commands.Context, game: SplitStealGame, conf: dict):
        super().__init__(timeout=120)
        self.cog = cog
        self.ctx = ctx
        self.game = game
        self.conf = conf
        self.message: Optional[discord.Message] = None
        self.last: str = ""

    def build_embed(self) -> discord.Embed:
        game = self.game
        if game.finished:
            winner = game.winner()
            title = (
                "🏆 You walk away with more"
                if winner == "player"
                else "🚔 The suspect out-played you"
                if winner == "bot"
                else "🤝 Dead heat"
            )
            color = WIN_COLOR if winner == "player" else LOSE_COLOR if winner == "bot" else SOLO_COLOR
        else:
            title = f"🕵️ Split or Steal — round {game.round_number}/{game.rounds}"
            color = SOLO_COLOR

        embed = discord.Embed(color=color, title=title)
        embed.description = (
            "Both **split** → you halve the pot.\n"
            "One **steals** → the thief takes it all.\n"
            "Both **steal** → nobody gets a thing."
        )
        embed.add_field(name="Pot this round", value=f"🍩 **{game.pot}**", inline=True)
        embed.add_field(name="You", value=f"🍩 **{game.player_total}**", inline=True)
        embed.add_field(name="Suspect", value=f"🍩 **{game.bot_total}**", inline=True)
        if self.last:
            embed.add_field(name="Last round", value=self.last, inline=False)
        if game.history:
            embed.add_field(
                name="History",
                value="\n".join(
                    f"`{i + 1}.` you **{player}** · suspect **{bot}**"
                    for i, (bot, player) in enumerate(game.history)
                )[:1024],
                inline=False,
            )
        if game.finished:
            embed.add_field(
                name=f"The suspect was {game.strategy.name}",
                value=game.strategy.tell,
                inline=False,
            )
        else:
            embed.set_footer(text="You only learn who you were up against at the end.")
        return embed

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user != self.ctx.author:
            await interaction.response.send_message(
                "This is not your interrogation.", ephemeral=True
            )
            return False
        return True

    async def choose(self, interaction: discord.Interaction, move: Move):
        bot_move, bot_share, player_share = self.game.play(move)
        self.last = (
            f"You **{move}**, the suspect **{bot_move}** → "
            f"you 🍩 **{player_share}**, suspect 🍩 **{bot_share}**"
        )
        if self.game.finished:
            for child in self.children:
                child.disabled = True  # type: ignore[attr-defined]
            self.stop()
            prize = await self.cog.award(self.ctx, self.conf, self.game.winner() == "player")
            embed = self.build_embed()
            if prize:
                embed.description = (embed.description or "") + prize
            await interaction.response.edit_message(embed=embed, view=self)
            return
        await interaction.response.edit_message(embed=self.build_embed(), view=self)

    async def on_timeout(self):
        for child in self.children:
            child.disabled = True  # type: ignore[attr-defined]
        if self.message is not None:
            try:
                await self.message.edit(
                    embed=self.build_embed().set_footer(text="Timed out — the suspect walked."),
                    view=self,
                )
            except discord.HTTPException:
                pass

    @discord.ui.button(label="Split", emoji="🤝", style=discord.ButtonStyle.success)
    async def split_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.choose(interaction, "split")

    @discord.ui.button(label="Steal", emoji="🔪", style=discord.ButtonStyle.danger)
    async def steal_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        await self.choose(interaction, "steal")
