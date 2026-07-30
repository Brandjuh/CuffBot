"""Tic-Tac-Toe, forked from crab-cogs `minigames/tictactoe.py`.

Rules and opponent untouched. Changed:

  * the money lines follow the entry-fee/pot rules in `base.py`;
  * the winning three light up green. The board here IS the buttons, so there
    is no grid to recolour — a style change is the whole highlight;
  * ⭕ is blue instead of red. Upstream gives both marks `0xDD2E44`, so the
    embed edge is the same colour whoever won, which reads as a bug once two
    players are on screen.
"""

import random
import discord
from enum import Enum
from typing import List, Optional, Set, Tuple, Union
from datetime import datetime

from cuffminigames.base import BaseMinigameCog, Minigame, stake_line
from cuffminigames.board import Board, Pos, find_lines, try_complete_line, winning_lines
from cuffminigames.views.minigame_view import MinigameView
from cuffminigames.views.invite_view import InviteView
from cuffminigames.views.rematch_view import RematchView


class Player(Enum):
    TIE = -2
    NONE = -1
    CROSS = 0
    CIRCLE = 1


COLORS = {
    Player.TIE: 0x78B159,
    Player.NONE: 0x31373D,
    Player.CROSS: 0xDD2E44,
    Player.CIRCLE: 0x55ACEE,
}
EMOJIS = {
    Player.NONE: "▪️",
    Player.CROSS: "❌",
    Player.CIRCLE: "⭕",
}
IMAGES = {
    Player.CROSS: "https://raw.githubusercontent.com/hollowstrawberry/crab-cogs/refs/heads/testing/minigames/media/x.png",
    Player.CIRCLE: "https://raw.githubusercontent.com/hollowstrawberry/crab-cogs/refs/heads/testing/minigames/media/o.png",
}


class TicTacToeGame(Minigame):
    def __init__(self, cog: BaseMinigameCog, players: List[discord.Member], channel: Union[discord.abc.GuildChannel, discord.Thread], entry: int):
        if len(players) != 2:
            raise ValueError("Game must have 2 players")
        super().__init__(cog, players, channel, entry)
        self.accepted = False
        self.board = Board(3, 3, Player.NONE)
        self.current = Player.CROSS
        self.winner = Player.NONE
        self.time = 0
        self.cancelled = False

    async def do_turn(self, player: discord.Member, slot: int):
        if player != self.member(self.current):
            raise ValueError(f"It's not {player.name}'s turn")
        if self.is_finished():
            raise ValueError("This game is finished")
        if slot < 0 or slot > 8:
            raise ValueError(f"Slot must be a number between 0 and 8, not {slot}")
        if self.board._data[slot] != Player.NONE:
            raise ValueError(f"Board slot {slot} is already occupied")

        self.last_interacted = datetime.now()
        self.time += 1
        self.board._data[slot] = self.current
        if self.check_win():
            self.winner = self.current
            await self.on_win(self.member(self.winner))
        elif self.is_finished():
            self.winner = Player.TIE
            await self.on_win(None, tie=True)
        else:
            self.current = self.opponent(self.current)

    async def do_turn_ai(self):
        target = try_complete_line(self.board, self.current, Player.NONE, 3) \
            or try_complete_line(self.board, self.opponent(self.current), Player.NONE, 3) \
            or self.get_random_unoccupied()
        await self.do_turn(self.member(self.current), target[1]*3 + target[0])

    def is_finished(self) -> bool:
        return self.winner != Player.NONE or self.cancelled or self.time == 9

    def is_cancelled(self) -> bool:
        return self.cancelled

    async def cancel(self, player: discord.Member):
        self.cancelled = True
        if self.time == 0:
            self.winner = Player.TIE
        elif player not in self.players:
            self.winner = Player.NONE
        else:
            self.winner = Player.CIRCLE if self.players.index(player) == 0 else Player.CROSS
        await self.on_win(
            self.member(self.winner) if self.winner.value >= 0 else None,
            tie=self.winner == Player.TIE,
        )

    def accept(self, _):
        self.accepted = True

    def check_win(self) -> bool:
        return find_lines(self.board, self.current, 3)

    def member(self, player: Player) -> discord.Member:
        if player.value < 0:
            raise ValueError("Invalid player")
        return self.players[player.value]

    @classmethod
    def opponent(cls, current: Player) -> Player:
        return Player.CIRCLE if current == Player.CROSS else Player.CROSS

    def get_random_unoccupied(self) -> Tuple[int, int]:
        empty_slots = []
        for y in range(3):
            for x in range(3):
                if self.board[x, y] == Player.NONE:
                    empty_slots.append((x, y))
        if not empty_slots:
            raise ValueError("No empty slots")
        return random.choice(empty_slots)

    def winning_slots(self) -> Set[int]:
        """Slot indices of the winning three, for the button highlight.

        Empty when the win came from a surrender — there is no line on the board
        in that case, and colouring three arbitrary buttons would be a lie.
        """
        if self.winner.value < 0:
            return set()
        return {y * 3 + x for run in winning_lines(self.board, self.winner, 3) for x, y in run}

    async def get_content(self) -> Optional[str]:
        if not self.accepted:
            return f"{self.players[0].mention} you've been invited to play Tic-Tac-Toe!"
        else:
            return None

    async def get_embed(self) -> discord.Embed:
        title = "Pending invitation..." if not self.accepted \
                else f"{self.member(self.current).display_name}'s turn" if not self.is_finished() \
                else "The game was cancelled!" if self.cancelled and self.winner.value < 0 \
                else "It's a tie!" if self.winner == Player.TIE \
                else f"{self.member(self.winner).display_name} is the winner via surrender!" if self.cancelled \
                else f"{self.member(self.winner).display_name} is the winner!"

        description = ""
        for i, player in enumerate(self.players):
            if self.winner.value == i:
                description += "👑 "
            elif not self.is_finished() and self.current.value == i and self.accepted:
                description += "►"
            description += f"{EMOJIS[Player(i)]} - {player.mention}"
            description += self.money_line(i)
            description += "\n"

        if self.winning_slots():
            description += "\n🏆 The winning line is the green row of buttons."
        if self.pot_note:
            description += "\n" + self.pot_note
        if not self.is_finished():
            description += "\n" + await stake_line(self)

        color = COLORS[self.winner] if self.winner != Player.NONE else COLORS[self.current]

        embed = discord.Embed(title=title, description=description, color=color)

        if self.is_finished():
            if self.winner.value >= 0:
                embed.set_thumbnail(url=self.member(self.winner).display_avatar.url)
        elif self.accepted:
            embed.set_thumbnail(url=IMAGES[self.current])

        return embed

    def money_line(self, seat: int) -> str:
        """What this seat won or lost, printed beside their name."""
        if self.entry <= 0 or self.pot <= 0 or self.players[seat].bot:
            return ""
        if self.winner.value == seat:
            return f" **+{self.pot:,} 🍩**"
        if self.winner.value >= 0 or (self.is_finished() and self.winner == Player.NONE):
            return f" **−{self.entry:,} 🍩**"
        return ""

    async def get_view(self) -> discord.ui.View:
        if not self.accepted:
            return InviteView(self)

        view = MinigameView(self) if not self.is_finished() else RematchView(self)
        winning = self.winning_slots()
        for i in range(9):
            slot: Player = self.board._data[i] # type: ignore
            button = discord.ui.Button(
                emoji=EMOJIS[slot],
                disabled= slot != Player.NONE or self.is_finished(),
                custom_id=f"cuffminigames ttt {self.channel.id} {i}",
                row=i//3,
                style=discord.ButtonStyle.success if i in winning else discord.ButtonStyle.secondary,
            )

            async def action(interaction: discord.Interaction, i=i):
                nonlocal self, view
                assert isinstance(interaction.user, discord.Member)
                if interaction.user not in self.players:
                    return await interaction.response.send_message("You're not playing this game!", ephemeral=True)
                if interaction.user != self.member(self.current):
                    return await interaction.response.send_message("It's not your turn!", ephemeral=True)
                await self.do_turn(interaction.user, i)
                if not self.is_finished() and self.member(self.current).bot:
                    await self.do_turn_ai()
                if self.is_finished():
                    view.stop()
                new_view = await self.get_view()
                await interaction.response.edit_message(content=await self.get_content(), embed=await self.get_embed(), view=new_view)
                if isinstance(new_view, RematchView):
                    new_view.message = interaction.message

            button.callback = action
            view.add_item(button)

        return view
