"""The game/cog contract and the money rules.

Forked from crab-cogs `minigames/base.py`. The board logic is untouched; the
**economy is rewritten** to the precinct's rules (owner, 2026-07-30):

  * every seat pays a fixed **entry fee**, the bot included — so a game against
    CuffBot has a real pot instead of a prize conjured for the human alone;
  * the **winner takes the whole pot**, not a configured payout;
  * when the player loses, the pot is **not** kept by the house: it goes into
    the **crack pot** (`CrackPot` cog), which is where every other lost donut in
    this precinct already ends up. "Alle verliezen gaan daarin."

What the upstream cog did instead, for the record: it charged the two humans in
a PvP game and paid the winner `bet * 2`; against the bot it charged the human
*nothing* and paid a flat `payout` on a win, which is a pure faucet.

⚠️ **The bot's entry is minted by the house** (owner's choice when asked). The
bot has no bank account, so its stake is created at game start; a human who
beats the bot therefore nets `+entry`. `[p]minigamesset botentry off` turns that
off and makes bot games break-even practice instead.
"""

import logging
import discord
from abc import ABC, abstractmethod
from typing import List, Optional, Set, Type, Union
from datetime import datetime
from redbot.core import commands, bank, errors

log = logging.getLogger("red.cuffcogs.cuffminigames")


async def stake_line(game: "Minigame") -> str:
    """The terms of a game, in one line, for the panel while it is running.

    Shown before a move is made as well as on the invitation: a game against the
    bot is accepted the moment it is created, so the invitation is the one place
    that never gets to tell the player what they are playing for.
    """
    if game.entry <= 0 or not await game.cog.is_economy_enabled(game.channel.guild):
        return ""
    against_bot = any(player.bot for player in game.players)
    bot_pays = against_bot and await game.cog.bot_pays_entry(game.channel.guild)
    seats = len(game.players) if (bot_pays or not against_bot) else len(game.players) - 1
    pot = game.entry * seats
    line = f"💰 Entry **{game.entry:,} 🍩** each — the winner takes the **{pot:,} 🍩** pot."
    if bot_pays:
        line += " I pay in too; if I win, the pot goes to the crack pot."
    return line


class BaseMinigameCog(commands.Cog):
    @abstractmethod
    async def is_economy_enabled(self, guild: discord.Guild) -> bool:
        pass

    @abstractmethod
    async def entry_fee(self, guild: discord.Guild) -> int:
        pass

    @abstractmethod
    async def bot_pays_entry(self, guild: discord.Guild) -> bool:
        pass

    @abstractmethod
    async def add_to_pot(self, guild: discord.Guild, amount: int) -> Optional[int]:
        pass

    @abstractmethod
    async def base_minigame_cmd(self,
                                game_cls: Type["Minigame"],
                                ctx: Union[commands.Context, discord.Interaction],
                                players: List[discord.Member],
                                against_bot: bool,
                                ) -> None:
        pass


class Minigame(ABC):
    def __init__(self, cog: BaseMinigameCog, players: List[discord.Member], channel: Union[discord.abc.GuildChannel, discord.Thread], entry: int):
        self.cog = cog
        self.entry = entry
        self.players = players
        self.channel = channel
        self.message: Optional[discord.Message] = None
        self.last_interacted: datetime = datetime.now()
        self.init_done = False
        self.payout_done = False
        #: What was actually collected. Not `entry * 2` on principle: a seat
        #: that could not pay contributes nothing, and the bot's seat only
        #: contributes while `botentry` is on.
        self.pot = 0
        #: Ids of the humans whose entry really left their account — the only
        #: people a tie may refund.
        self.paid: Set[int] = set()
        #: Set on settlement when the pot went to the crack pot, so the result
        #: embed can say where the money went and what the pot stands at now.
        self.pot_note: Optional[str] = None

    @abstractmethod
    def is_finished(self) -> bool:
        pass

    @abstractmethod
    def is_cancelled(self) -> bool:
        pass

    @abstractmethod
    async def cancel(self, player: Optional[discord.Member]) -> None:
        pass

    @abstractmethod
    def accept(self, player: discord.Member) -> None:
        pass

    @abstractmethod
    async def get_content(self) -> Optional[str]:
        pass

    @abstractmethod
    async def get_embed(self) -> discord.Embed:
        pass

    @abstractmethod
    async def get_view(self) -> discord.ui.View:
        pass

    # ----------------------------------------------------------------- #
    # Money                                                             #
    # ----------------------------------------------------------------- #

    async def init(self) -> None:
        """Collect the entry fees. Called the moment a game really starts.

        Never when it is merely offered: an invitation nobody answers must not
        cost anybody anything.
        """
        if self.init_done:
            return
        self.init_done = True
        if self.entry <= 0 or not await self.cog.is_economy_enabled(self.channel.guild):
            return

        bot_pays = await self.cog.bot_pays_entry(self.channel.guild)
        for player in self.players:
            if player.bot:
                # The house stakes on the bot's behalf — there is no account to
                # take it from. This is the one place donuts are created.
                if bot_pays:
                    self.pot += self.entry
                continue
            try:
                await bank.withdraw_credits(player, self.entry)
            except ValueError:
                # Affordability is checked before the panel goes up and again on
                # accept, so this is a race, not a normal path. Losing the game
                # over it would be worse than letting them play for free.
                log.warning("Entry fee could not be collected from %s", player.id)
                continue
            self.paid.add(player.id)
            self.pot += self.entry

    async def on_win(self, winner: Optional[discord.Member], tie: bool = False) -> None:
        """Settle the pot exactly once.

        `winner` is None for both a tie and an abandoned game, and those pay out
        in opposite directions, so the caller states which it is.
        """
        if self.payout_done:
            return
        self.payout_done = True
        if not await self.cog.is_economy_enabled(self.channel.guild):
            return
        await self.init()  # failsafe: a game can end before anything called init
        if self.pot <= 0:
            return

        if winner is None:
            if tie:
                # Both stakes come back. The bot's minted share is simply
                # dropped — it never belonged to anybody.
                for player in self.players:
                    if player.id in self.paid:
                        await self._deposit(player, self.entry)
            else:
                # Nobody won and nobody was refunded: those donuts are lost, and
                # every lost donut in this precinct goes to the same place.
                await self._to_crack_pot()
            return

        if winner.bot:
            await self._to_crack_pot()
        else:
            await self._deposit(winner, self.pot)

    async def _deposit(self, member: discord.Member, amount: int) -> None:
        try:
            await bank.deposit_credits(member, amount)
        except errors.BalanceTooHigh as error:
            await bank.set_balance(member, error.max_balance)

    async def _to_crack_pot(self) -> None:
        balance = await self.cog.add_to_pot(self.channel.guild, self.pot)
        #: A `None` balance means the CrackPot cog is not loaded (or errored).
        #: Saying the donuts went into the pot anyway would be a lie printed
        #: under the board, so the two cases read differently.
        self.pot_note = (
            f"💰 The **{self.pot:,} 🍩** pot goes into the crack pot — now **{balance:,} 🍩**."
            if balance is not None
            else f"💰 The **{self.pot:,} 🍩** pot is forfeited."
        )
