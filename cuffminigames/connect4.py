"""Connect 4, forked from crab-cogs `minigames/connect4.py`.

The rules and the opponent are untouched. Two things changed:

  * **the winning line is shown** — the four (or more) pieces that won turn into
    bright squares, the column header stays on screen after the game ends, and a
    line under the board names the direction and the columns. Upstream drew the
    finished board exactly like a running one, so the only way to find out how
    somebody won was to count pieces yourself;
  * the money lines follow the entry-fee/pot rules in `base.py`.
"""

import random
import discord
from enum import Enum
from typing import List, Optional, Tuple, Union
from datetime import datetime

from cuffminigames.base import BaseMinigameCog, Minigame, stake_line
from cuffminigames.board import Board, Pos, find_lines, winning_lines
from cuffminigames.views.minigame_view import MinigameView
from cuffminigames.views.invite_view import InviteView
from cuffminigames.views.rematch_view import RematchView


class Player(Enum):
    TIE = -2
    NONE = -1
    RED = 0
    BLUE = 1


COLORS = {
    Player.TIE: 0x78B159,
    Player.NONE: 0x31373D,
    Player.RED: 0xDD2E44,
    Player.BLUE: 0x55ACEE,
}
EMOJIS = {
    Player.NONE: "⚫",
    Player.RED: "🔴",
    Player.BLUE: "🔵",
}
#: The same two colours as squares. A circle and a square of the same colour are
#: still told apart at a glance on a phone, which "slightly brighter red" was
#: not — and the caption below the board says it in words as well.
WIN_EMOJIS = {
    Player.RED: "🟥",
    Player.BLUE: "🟦",
}
IMAGES = {
    Player.RED: "https://raw.githubusercontent.com/hollowstrawberry/crab-cogs/refs/heads/testing/minigames/media/red.png",
    Player.BLUE: "https://raw.githubusercontent.com/hollowstrawberry/crab-cogs/refs/heads/testing/minigames/media/blue.png",
}
NUMBERS = ["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "6️⃣", "7️⃣"]

#: Direction of a line → how to say it. Keyed by the step between two
#: consecutive cells of the run, which is what `describe_line` measures.
DIRECTION_NAMES = {
    (1, 0): ("➡️", "horizontal"),
    (0, 1): ("⬇️", "vertical"),
    (1, 1): ("↘️", "diagonal"),
    (1, -1): ("↗️", "diagonal"),
}


def describe_line(cells: List[Pos]) -> str:
    """One line of prose naming a winning run: direction, and where it sits.

    A vertical run is named by its single column; every other run lists the
    columns it spans, because those are the numbers on the header row and the
    numbers on the buttons a player would have pressed.
    """
    ordered = sorted(cells)
    (x0, y0), (x1, y1) = ordered[0], ordered[1]
    step = (x1 - x0, y1 - y0)
    arrow, name = DIRECTION_NAMES.get(step, ("🏆", "line"))
    if step == (0, 1):
        return f"🏆 Winning line: {arrow} {name} — column {NUMBERS[x0]}"
    columns = "".join(NUMBERS[x] for x, _ in ordered)
    return f"🏆 Winning line: {arrow} {name} — {columns}"


class ConnectFourGame(Minigame):
    def __init__(self, cog: BaseMinigameCog, players: List[discord.Member], channel: Union[discord.abc.GuildChannel, discord.Thread], entry: int):
        if len(players) != 2:
            raise ValueError("Game must have 2 players")
        super().__init__(cog, players, channel, entry)
        self.accepted = False
        self.board = Board(7, 6, Player.NONE)
        self.current = Player.RED
        self.winner = Player.NONE
        self.time = 0
        self.cancelled = False

    async def do_turn(self, player: discord.Member, column: int):
        if player != self.member(self.current):
            raise ValueError(f"It's not {player.name}'s turn")
        if self.is_finished():
            raise ValueError("This game is finished")
        if column < 0 or column > self.board.width - 1:
            raise ValueError(f"Column must be a number between 0 and {self.board.width - 1}, not {column}")

        row = self.get_highest_slot(self.board, column)
        if row is None:
            raise ValueError("Column is full")

        self.last_interacted = datetime.now()
        self.time += 1
        self.board[column, row] = self.current
        if self.check_win(self.board, self.current, self.time):
            self.winner = self.current
            await self.on_win(self.member(self.winner))
        elif self.is_finished():
            self.winner = Player.TIE
            await self.on_win(None, tie=True)
        else:
            self.current = self.opponent(self.current)

    async def do_turn_ai(self):
        moves = {}
        avoid_moves = []
        columns = self.available_columns(self.board)
        if len(columns) == 1:
            moves[columns[0]] = 0
        else:
            for column in columns: # All moves it can make
                temp_board = self.board.copy()
                self.drop_piece(temp_board, column, self.current)
                if self.check_win(temp_board, self.current, self.time + 1): # Can win instantly
                    moves = {column: 0}
                    avoid_moves = []
                    break
                # The AI plays defensively, so it mostly avoids possible futures where it may lose
                lose_count = self.may_lose_count(temp_board, self.current, self.opponent(self.current), self.time + 1, depth=3)
                moves[column] = lose_count
                if self.may_lose_count(temp_board, self.current, self.opponent(self.current), self.time + 1, depth=1) > 0: # Can lose next turn
                    avoid_moves.append(column)
        if len(avoid_moves) < len(moves):
            for move in avoid_moves:
                moves.pop(move)
        least_loses = min(moves.values())
        final_options = [col for col, val in moves.items() if val == least_loses]
        move = random.choice(final_options)
        await self.do_turn(self.member(self.current), move)

    def is_finished(self) -> bool:
        return self.winner != Player.NONE or self.cancelled or self.time == len(self.board._data)

    def is_cancelled(self) -> bool:
        return self.cancelled

    async def cancel(self, player: discord.Member):
        self.cancelled = True
        if self.time == 0:
            self.winner = Player.TIE
        elif player not in self.players:
            self.winner = Player.NONE
        else:
            self.winner = Player.BLUE if self.players.index(player) == 0 else Player.RED
        await self.on_win(
            self.member(self.winner) if self.winner.value >= 0 else None,
            tie=self.winner == Player.TIE,
        )

    def accept(self, _):
        self.accepted = True

    def member(self, player: Player) -> discord.Member:
        if player.value < 0:
            raise ValueError("Invalid player")
        return self.players[player.value]

    @classmethod
    def opponent(cls, current: Player) -> Player:
        return Player.BLUE if current == Player.RED else Player.RED

    @classmethod
    def check_win(cls, board: Board, color: Player, time: int) -> bool:
        return find_lines(board, color, 4)

    @classmethod
    def get_highest_slot(cls, board: Board, column: int) -> Optional[int]:
        if column < 0 or column > board.width - 1:
            raise ValueError("Invalid column")
        for row in range(board.height - 1, -1, -1):
            if board[column, row] == Player.NONE:
                return row
        return None

    @classmethod
    def drop_piece(cls, board: Board, column: int, color: Player):
        if column < 0 or column > board.width - 1:
            raise ValueError("Invalid column")
        row = cls.get_highest_slot(board, column)
        if row is None:
            raise ValueError("Column is full")
        board[column, row] = color

    @classmethod
    def available_columns(cls, board: Board):
        return [col for col in range(board.width) if cls.get_highest_slot(board, col) is not None]

    @classmethod
    def get_random_unoccupied(cls, board: Board) -> int:
        available_columns = cls.available_columns(board)
        if not available_columns:
            raise ValueError("No available columns")
        return random.choice(available_columns)

    @classmethod
    def may_lose_count(cls, board: Board, color: Player, current: Player, time: int, depth: int):
        count = 0
        if depth <= 0 or time == len(board._data):
            return count
        for column in cls.available_columns(board):
            temp_board = board.copy()
            cls.drop_piece(temp_board, column, current)
            if current != color and cls.check_win(temp_board, current, time + 1):
                count += 1
            elif current != color or not cls.check_win(temp_board, current, time + 1):
                count += cls.may_lose_count(temp_board, color, cls.opponent(current), time + 1, depth - 1)
        return count

    # ----------------------------------------------------------------- #
    # The winning line                                                  #
    # ----------------------------------------------------------------- #

    def winning_runs(self) -> List[List[Pos]]:
        """The runs that won, or nothing while the game is undecided.

        A surrendered game has a winner without a line on the board, which is
        exactly the case a naive "highlight the winner's four" would render as
        an unmarked board and a caption pointing at nothing.
        """
        if self.winner.value < 0:
            return []
        return winning_lines(self.board, self.winner, 4)

    def render_board(self, runs: List[List[Pos]]) -> str:
        highlight = {cell for run in runs for cell in run}
        rows = ["".join(NUMBERS[x] for x in range(self.board.width))]
        for y in range(self.board.height):
            row = ""
            for x in range(self.board.width):
                cell: Player = self.board[x, y]  # type: ignore
                row += WIN_EMOJIS[cell] if (x, y) in highlight else EMOJIS[cell]
            rows.append(row)
        return "\n".join(rows)

    # ----------------------------------------------------------------- #
    # Presentation                                                      #
    # ----------------------------------------------------------------- #

    async def get_content(self) -> Optional[str]:
        if not self.accepted:
            return f"{self.players[0].mention} you've been invited to play Connect 4!"
        else:
            return None

    async def get_embed(self) -> discord.Embed:
        title = "Pending invitation..." if not self.accepted \
                else f"{self.member(self.current).display_name}'s turn" if not self.is_finished() \
                else "The game was cancelled!" if self.cancelled and self.winner.value < 0 \
                else "It's a tie!" if self.winner == Player.TIE \
                else f"{self.member(self.winner).display_name} is the winner via surrender!" if self.cancelled \
                else f"{self.member(self.winner).display_name} is the winner!"

        runs = self.winning_runs()

        description = ""
        for i, player in enumerate(self.players):
            if self.winner.value == i:
                description += "👑 "
            elif not self.is_finished() and self.current.value == i and self.accepted:
                description += "►"
            description += f"{EMOJIS[Player(i)]} - {player.mention}"
            description += self.money_line(i)
            description += "\n"
        description += "\n"

        description += self.render_board(runs)
        description += "\n"

        if runs:
            # Two lines at once is rare but real (a double-ended four), and a
            # caption naming only one of them would point at half the reason.
            description += "\n" + "\n".join(describe_line(run) for run in runs)
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

    async def get_view(self) -> Optional[discord.ui.View]:
        if not self.accepted:
            return InviteView(self)
        if self.is_finished():
            return RematchView(self)

        view = MinigameView(self)
        options = [discord.SelectOption(label=f"{col + 1}", value=f"{col}") for col in self.available_columns(self.board)]
        select = discord.ui.Select(row=0, options=options, placeholder="Choose column to drop a piece...", custom_id=f"cuffminigames c4 {self.channel.id}")

        async def action(interaction: discord.Interaction):
            nonlocal self, view
            assert isinstance(interaction.user, discord.Member)
            if interaction.user not in self.players:
                return await interaction.response.send_message("You're not playing this game!", ephemeral=True)
            if interaction.user != self.member(self.current):
                return await interaction.response.send_message("It's not your turn!", ephemeral=True)
            await self.do_turn(interaction.user, int(interaction.data['values'][0])) # type: ignore
            if not self.is_finished() and self.member(self.current).bot:
                await self.do_turn_ai()
            if self.is_finished():
                view.stop()
            new_view = await self.get_view()
            await interaction.response.edit_message(content=await self.get_content(), embed=await self.get_embed(), view=new_view)
            if isinstance(new_view, RematchView):
                new_view.message = interaction.message

        select.callback = action
        view.add_item(select)
        return view
