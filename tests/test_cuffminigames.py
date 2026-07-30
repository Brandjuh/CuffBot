"""Pure-logic checks on CuffMinigames: the winning line, and the money.

No Discord, no Red Config — the game classes only ever touch `bank` through
`cuffminigames.base`, so a fake bank module in that one place is enough to play
whole games and watch every donut move.

Run with the bot's own venv:

    ~/cuffenv/bin/python tests/test_cuffminigames.py
"""

import asyncio
import sys
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cuffminigames import base
from cuffminigames.board import Board, winning_lines
from cuffminigames.connect4 import ConnectFourGame, Player as C4, describe_line
from cuffminigames.tictactoe import TicTacToeGame, Player as T3

failures = []


def check(name, condition, detail=""):
    print(("  ok   " if condition else "  FAIL ") + name + (f" — {detail}" if detail else ""))
    if not condition:
        failures.append(name)


# ------------------------------------------------------------------ #
# Fakes                                                              #
# ------------------------------------------------------------------ #

class FakeBank:
    """Just enough of `redbot.core.bank` for the two calls base.py makes."""

    def __init__(self, balances):
        self.balances = dict(balances)

    async def withdraw_credits(self, member, amount):
        if self.balances.get(member.id, 0) < amount:
            raise ValueError("not enough")
        self.balances[member.id] -= amount

    async def deposit_credits(self, member, amount):
        self.balances[member.id] = self.balances.get(member.id, 0) + amount

    async def can_spend(self, member, amount):
        return self.balances.get(member.id, 0) >= amount


class FakeCog:
    def __init__(self, entry=100, bot_pays=True, economy=True, crackpot=True):
        self.entry = entry
        self.bot_pays = bot_pays
        self.economy = economy
        self.crackpot = crackpot
        self.pot_balance = 5000

    async def is_economy_enabled(self, guild):
        return self.economy

    async def entry_fee(self, guild):
        return self.entry

    async def bot_pays_entry(self, guild):
        return self.bot_pays

    async def add_to_pot(self, guild, amount):
        if not self.crackpot:
            return None
        self.pot_balance += amount
        return self.pot_balance


def member(id_, name, is_bot=False):
    return SimpleNamespace(id=id_, name=name, display_name=name, mention=f"<@{id_}>", bot=is_bot)


GUILD = SimpleNamespace(id=1)
CHANNEL = SimpleNamespace(id=2, guild=GUILD)


def new_c4(cog, players):
    return ConnectFourGame(cog, players, CHANNEL, cog.entry)


def new_ttt(cog, players):
    return TicTacToeGame(cog, players, CHANNEL, cog.entry)


def run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


# ------------------------------------------------------------------ #
# The winning line                                                   #
# ------------------------------------------------------------------ #

def test_lines():
    print("\nwinning lines")

    board = Board(7, 6, C4.NONE)
    for x in range(4):
        board[x, 5] = C4.RED
    runs = winning_lines(board, C4.RED, 4)
    check("horizontal found once", runs == [[(0, 5), (1, 5), (2, 5), (3, 5)]], str(runs))
    check("horizontal described", describe_line(runs[0]) == "🏆 Winning line: ➡️ horizontal — 1️⃣2️⃣3️⃣4️⃣", describe_line(runs[0]))

    board = Board(7, 6, C4.NONE)
    for y in range(2, 6):
        board[3, y] = C4.BLUE
    runs = winning_lines(board, C4.BLUE, 4)
    check("vertical found once", len(runs) == 1 and len(runs[0]) == 4, str(runs))
    check("vertical names one column", describe_line(runs[0]) == "🏆 Winning line: ⬇️ vertical — column 4️⃣", describe_line(runs[0]))

    board = Board(7, 6, C4.NONE)
    for i in range(4):
        board[i, 5 - i] = C4.RED  # up to the right
    runs = winning_lines(board, C4.RED, 4)
    check("up diagonal described", describe_line(runs[0]) == "🏆 Winning line: ↗️ diagonal — 1️⃣2️⃣3️⃣4️⃣", describe_line(runs[0]))

    board = Board(7, 6, C4.NONE)
    for i in range(4):
        board[2 + i, i] = C4.BLUE  # down to the right
    runs = winning_lines(board, C4.BLUE, 4)
    check("down diagonal described", describe_line(runs[0]) == "🏆 Winning line: ↘️ diagonal — 3️⃣4️⃣5️⃣6️⃣", describe_line(runs[0]))

    board = Board(7, 6, C4.NONE)
    for x in range(3):
        board[x, 5] = C4.RED
    check("three in a row is not a line", winning_lines(board, C4.RED, 4) == [])

    # Five in a row is one line of five, not two overlapping fours.
    board = Board(7, 6, C4.NONE)
    for x in range(5):
        board[x, 5] = C4.RED
    runs = winning_lines(board, C4.RED, 4)
    check("five in a row is one run of five", len(runs) == 1 and len(runs[0]) == 5, str(runs))

    # Two lines at once are both reported.
    board = Board(7, 6, C4.NONE)
    for x in range(4):
        board[x, 5] = C4.RED
    for y in range(2, 6):
        board[0, y] = C4.RED
    runs = winning_lines(board, C4.RED, 4)
    check("two lines both reported", len(runs) == 2, str(runs))


def test_render():
    print("\nboard rendering")
    cog = FakeCog()
    human, bot = member(10, "Brand"), member(99, "CuffBot", True)
    game = new_c4(cog, [human, bot])
    for x in range(4):
        game.board[x, 5] = C4.RED
    game.board[6, 5] = C4.BLUE
    game.winner = C4.RED

    rows = game.render_board(game.winning_runs()).split("\n")
    check("header row is always drawn", rows[0] == "1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣", rows[0])
    check("winning four are squares", rows[-1].startswith("🟥🟥🟥🟥"), rows[-1])
    check("the loser's piece is untouched", rows[-1].endswith("🔵"), rows[-1])
    check("empty cells stay empty", rows[1] == "⚫" * 7, rows[1])

    # ⚠️ `Player.NONE` is the value an EMPTY cell holds, so an abandoned game
    # (winner NONE) asking "which cells are the winner's?" would come back with
    # every empty run on the board and paint most of it. The guard in
    # `winning_runs` is what stops that, and this is the case that proves it.
    game.winner = C4.NONE
    check("an abandoned game highlights nothing", game.winning_runs() == [], str(game.winning_runs()))
    check("and no square reaches the board", "🟥" not in game.render_board(game.winning_runs()))
    game.winner = C4.TIE
    check("a tie highlights nothing", game.winning_runs() == [], str(game.winning_runs()))


def test_ttt_highlight():
    print("\ntic-tac-toe highlight")
    cog = FakeCog()
    a, b = member(10, "Brand"), member(11, "Ody")
    game = new_ttt(cog, [a, b])
    for slot in (0, 1, 2):
        game.board._data[slot] = T3.CROSS
    game.winner = T3.CROSS
    check("top row lights up", game.winning_slots() == {0, 1, 2}, str(game.winning_slots()))
    game.winner = T3.NONE
    check("undecided game highlights nothing", game.winning_slots() == set())


# ------------------------------------------------------------------ #
# The money                                                          #
# ------------------------------------------------------------------ #

def play_c4_red_win(game, red, blue):
    """Red takes the bottom row; Blue answers on the right. Red wins 1️⃣–4️⃣."""
    run(game.do_turn(red, 0))
    run(game.do_turn(blue, 6))
    run(game.do_turn(red, 1))
    run(game.do_turn(blue, 5))
    run(game.do_turn(red, 2))
    run(game.do_turn(blue, 6))
    run(game.do_turn(red, 3))


def test_pvp_money():
    print("\nmoney — officer versus officer")
    cog = FakeCog()
    a, b = member(10, "Brand"), member(11, "Ody")
    bank = FakeBank({10: 1000, 11: 1000})
    base.bank = bank

    game = new_c4(cog, [a, b])
    game.accept(a)
    run(game.init())
    check("both entries collected", (bank.balances[10], bank.balances[11]) == (900, 900), str(bank.balances))
    check("pot is both entries", game.pot == 200, str(game.pot))

    play_c4_red_win(game, a, b)
    check("winner took the pot", bank.balances[10] == 1100, str(bank.balances[10]))
    check("loser is down the entry", bank.balances[11] == 900, str(bank.balances[11]))
    check("crack pot untouched in pvp", cog.pot_balance == 5000, str(cog.pot_balance))
    check("winner's money line", game.money_line(0) == " **+200 🍩**", game.money_line(0))
    check("loser's money line", game.money_line(1) == " **−100 🍩**", game.money_line(1))


def test_bot_game_player_wins():
    print("\nmoney — the player beats the bot")
    cog = FakeCog()
    human, bot = member(10, "Brand"), member(99, "CuffBot", True)
    bank = FakeBank({10: 1000})
    base.bank = bank

    game = new_c4(cog, [human, bot])
    game.accept(human)
    run(game.init())
    check("only the human is charged", bank.balances[10] == 900, str(bank.balances[10]))
    check("the house staked for the bot", game.pot == 200, str(game.pot))

    play_c4_red_win(game, human, bot)
    check("player takes the whole pot", bank.balances[10] == 1100, str(bank.balances[10]))
    check("crack pot untouched", cog.pot_balance == 5000, str(cog.pot_balance))


def test_bot_game_player_loses():
    print("\nmoney — the bot wins")
    cog = FakeCog()
    human, bot = member(10, "Brand"), member(99, "CuffBot", True)
    bank = FakeBank({10: 1000})
    base.bank = bank

    game = new_c4(cog, [human, bot])
    game.accept(human)
    run(game.init())
    run(game.do_turn(human, 0))       # so the surrender is not the "no moves" case
    run(game.cancel(human))           # surrender hands the win to the bot

    check("the bot is the winner", game.winner == C4.BLUE, str(game.winner))
    check("player keeps nothing back", bank.balances[10] == 900, str(bank.balances[10]))
    check("the whole pot went to the crack pot", cog.pot_balance == 5200, str(cog.pot_balance))
    check("and the panel says so", game.pot_note == "💰 The **200 🍩** pot goes into the crack pot — now **5,200 🍩**.", str(game.pot_note))


def test_abandoned_game():
    print("\nmoney — a stranger replaces a live game")
    cog = FakeCog()
    a, b = member(10, "Brand"), member(11, "Ody")
    stranger = member(12, "Nobody")
    bank = FakeBank({10: 1000, 11: 1000})
    base.bank = bank

    game = new_c4(cog, [a, b])
    game.accept(a)
    run(game.init())
    run(game.do_turn(a, 0))
    run(game.cancel(stranger))

    check("nobody won", game.winner == C4.NONE, str(game.winner))
    check("no refunds", (bank.balances[10], bank.balances[11]) == (900, 900), str(bank.balances))
    check("the pot is not lost, it is pooled", cog.pot_balance == 5200, str(cog.pot_balance))


def test_cancelled_before_a_move():
    print("\nmoney — cancelled before anyone played")
    cog = FakeCog()
    a, b = member(10, "Brand"), member(11, "Ody")
    bank = FakeBank({10: 1000, 11: 1000})
    base.bank = bank

    game = new_c4(cog, [a, b])
    game.accept(a)
    run(game.init())
    run(game.cancel(a))
    check("both entries returned", (bank.balances[10], bank.balances[11]) == (1000, 1000), str(bank.balances))
    check("crack pot untouched", cog.pot_balance == 5000, str(cog.pot_balance))


def test_tie():
    print("\nmoney — a tie")
    cog = FakeCog()
    a, b = member(10, "Brand"), member(11, "Ody")
    bank = FakeBank({10: 1000, 11: 1000})
    base.bank = bank

    game = new_ttt(cog, [a, b])
    game.accept(a)
    run(game.init())
    for slot, player in [(0, a), (1, b), (2, a), (4, b), (3, a), (5, b), (7, a), (6, b), (8, a)]:
        run(game.do_turn(player, slot))

    check("it is a tie", game.winner == T3.TIE, str(game.winner))
    check("both entries returned", (bank.balances[10], bank.balances[11]) == (1000, 1000), str(bank.balances))
    check("crack pot untouched", cog.pot_balance == 5000, str(cog.pot_balance))
    check("no money line on a tie", game.money_line(0) == "", game.money_line(0))


def test_tie_against_the_bot():
    print("\nmoney — a tie against the bot")
    cog = FakeCog()
    human, bot = member(10, "Brand"), member(99, "CuffBot", True)
    bank = FakeBank({10: 1000})
    base.bank = bank

    game = new_ttt(cog, [human, bot])
    game.accept(human)
    run(game.init())
    for slot, player in [(0, human), (1, bot), (2, human), (4, bot), (3, human), (5, bot), (7, human), (6, bot), (8, human)]:
        run(game.do_turn(player, slot))

    check("human gets their entry back", bank.balances[10] == 1000, str(bank.balances[10]))
    # The bot's stake was minted at kick-off and belongs to nobody, so a tie
    # must not hand it out — not to the player, and not to the crack pot.
    check("the minted half is dropped", cog.pot_balance == 5000, str(cog.pot_balance))


def test_botentry_off():
    print("\nmoney — botentry off")
    cog = FakeCog(bot_pays=False)
    human, bot = member(10, "Brand"), member(99, "CuffBot", True)
    bank = FakeBank({10: 1000})
    base.bank = bank

    game = new_c4(cog, [human, bot])
    game.accept(human)
    run(game.init())
    check("pot is the human's entry only", game.pot == 100, str(game.pot))
    play_c4_red_win(game, human, bot)
    check("winning returns exactly the entry", bank.balances[10] == 1000, str(bank.balances[10]))


def test_free_games():
    print("\nmoney — entry 0")
    cog = FakeCog(entry=0)
    a, b = member(10, "Brand"), member(11, "Ody")
    bank = FakeBank({10: 1000, 11: 1000})
    base.bank = bank

    game = new_c4(cog, [a, b])
    game.accept(a)
    run(game.init())
    play_c4_red_win(game, a, b)
    check("nothing moved", (bank.balances[10], bank.balances[11]) == (1000, 1000), str(bank.balances))
    check("no money lines", game.money_line(0) == "" and game.money_line(1) == "")
    check("no stake line", run(base.stake_line(game)) == "")


def test_economy_off():
    print("\nmoney — Economy cog unloaded")
    cog = FakeCog(economy=False)
    a, b = member(10, "Brand"), member(11, "Ody")
    bank = FakeBank({10: 1000, 11: 1000})
    base.bank = bank

    game = new_c4(cog, [a, b])
    game.accept(a)
    run(game.init())
    play_c4_red_win(game, a, b)
    check("nothing moved", (bank.balances[10], bank.balances[11]) == (1000, 1000), str(bank.balances))


def test_crackpot_missing():
    print("\nmoney — CrackPot cog unloaded")
    cog = FakeCog(crackpot=False)
    human, bot = member(10, "Brand"), member(99, "CuffBot", True)
    base.bank = FakeBank({10: 1000})

    game = new_c4(cog, [human, bot])
    game.accept(human)
    run(game.init())
    run(game.do_turn(human, 0))
    run(game.cancel(human))
    check("the panel does not claim a pot that never took it",
          game.pot_note == "💰 The **200 🍩** pot is forfeited.", str(game.pot_note))


def test_settled_once():
    print("\nsettlement happens once")
    cog = FakeCog()
    a, b = member(10, "Brand"), member(11, "Ody")
    bank = FakeBank({10: 1000, 11: 1000})
    base.bank = bank

    game = new_c4(cog, [a, b])
    game.accept(a)
    run(game.init())
    play_c4_red_win(game, a, b)
    won = bank.balances[10]
    run(game.on_win(a))          # a stray second settlement
    run(game.cancel(a))          # and a surrender after the fact
    check("the prize is paid once", bank.balances[10] == won, str(bank.balances[10]))


def test_stake_line():
    print("\nthe stake line")
    human, bot = member(10, "Brand"), member(99, "CuffBot", True)
    a, b = member(10, "Brand"), member(11, "Ody")
    base.bank = FakeBank({10: 1000, 11: 1000})

    game = new_c4(FakeCog(), [human, bot])
    line = run(base.stake_line(game))
    check("bot game names the doubled pot", "200 🍩** pot" in line and "I pay in too" in line, line)

    game = new_c4(FakeCog(bot_pays=False), [human, bot])
    line = run(base.stake_line(game))
    check("botentry off names the single pot", "100 🍩** pot" in line and "I pay in" not in line, line)

    game = new_c4(FakeCog(), [a, b])
    line = run(base.stake_line(game))
    check("pvp names the doubled pot", "200 🍩** pot" in line and "I pay in" not in line, line)


if __name__ == "__main__":
    test_lines()
    test_render()
    test_ttt_highlight()
    test_pvp_money()
    test_bot_game_player_wins()
    test_bot_game_player_loses()
    test_abandoned_game()
    test_cancelled_before_a_move()
    test_tie()
    test_tie_against_the_bot()
    test_botentry_off()
    test_free_games()
    test_economy_off()
    test_crackpot_missing()
    test_settled_once()
    test_stake_line()

    print()
    if failures:
        print(f"{len(failures)} FAILED: " + ", ".join(failures))
        sys.exit(1)
    print("all checks passed")
