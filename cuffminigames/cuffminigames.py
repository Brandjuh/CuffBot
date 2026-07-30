"""CuffMinigames — Connect 4 and Tic-Tac-Toe on the precinct's own money rules.

Fork of crab-cogs `minigames` (hollowstrawberry). The games are theirs; the
economy is the precinct's:

  * one fixed **entry fee** per seat, the bot's included (owner, 2026-07-30);
  * the **winner takes the pot**;
  * a pot the player does not win goes to the **crack pot**, like every other
    lost donut here.

Forked rather than patched in place because the upstream copy lives under
Downloader and `[p]cog update` would put it back the way it was, without a word.
"""

import logging
import discord
from typing import Dict, List, Optional, Type, Union
from datetime import datetime
from redbot.core import commands, app_commands, bank, checks, Config
from redbot.core.bot import Red
from redbot.core.utils.chat_formatting import humanize_timedelta

from cuffminigames.base import Minigame, BaseMinigameCog
from cuffminigames.connect4 import ConnectFourGame
from cuffminigames.tictactoe import TicTacToeGame
from cuffminigames.views.replace_view import ReplaceView

log = logging.getLogger("red.cuffcogs.cuffminigames")

TIME_LIMIT = 5 # minutes

DEFAULT_CONFIG = {
    #: What every seat puts in. The owner's number; both games share it, because
    #: both games cost the same to sit down at.
    "entry_fee": 100,
    #: Whether the house stakes on the bot's behalf. On: a bot game has a real
    #: 200 pot and beating me is worth +100. Off: the bot contributes nothing,
    #: so winning returns your own entry and losing feeds the crack pot.
    "bot_pays_entry": True,
}


class CuffMinigames(BaseMinigameCog):
    """
    Play Connect 4 and Tic-Tac-Toe against your friends or the bot.
    Every seat pays an entry fee; the winner takes the pot.
    """

    def __init__(self, bot: Red):
        super().__init__()
        self.bot = bot
        self.games: Dict[int, Minigame] = {}
        self.config = Config.get_conf(self, identifier=8812440371)
        self.config.register_guild(**DEFAULT_CONFIG)
        self.config.register_global(**DEFAULT_CONFIG)

    # ----------------------------------------------------------------- #
    # The cog contract `base.py` calls back into                        #
    # ----------------------------------------------------------------- #

    async def is_economy_enabled(self, guild: discord.Guild) -> bool:
        economy = self.bot.get_cog("Economy")
        return economy is not None and not await self.bot.cog_disabled_in_guild(economy, guild)

    async def entry_fee(self, guild: discord.Guild) -> int:
        if await bank.is_global():
            return max(0, int(await self.config.entry_fee()))
        return max(0, int(await self.config.guild(guild).entry_fee()))

    async def bot_pays_entry(self, guild: discord.Guild) -> bool:
        if await bank.is_global():
            return bool(await self.config.bot_pays_entry())
        return bool(await self.config.guild(guild).bot_pays_entry())

    async def add_to_pot(self, guild: discord.Guild, amount: int) -> Optional[int]:
        """Hand donuts to the CrackPot cog. Returns the new pot, or None.

        Wrapped the way every other cross-cog call in this repo is: a crack pot
        that is unloaded or broken must not take a finished game down with it.
        """
        pot_cog = self.bot.get_cog("CrackPot")
        if pot_cog is None:
            return None
        try:
            return await pot_cog.add_to_pot(guild, amount)
        except Exception:
            log.exception("add_to_pot failed")
            return None

    # ----------------------------------------------------------------- #
    # Commands                                                          #
    # ----------------------------------------------------------------- #

    @commands.hybrid_command(name="tictactoe", aliases=["ttt"])
    @app_commands.describe(opponent="Invite another officer to play.")
    @commands.guild_only()
    async def tictactoe(self, ctx: commands.Context, opponent: Optional[discord.Member] = None):
        """
        Play a game of Tic-Tac-Toe against the bot or another officer.
        """
        assert ctx.guild and isinstance(ctx.author, discord.Member)
        opponent = opponent or ctx.guild.me
        players = [ctx.author, opponent] if opponent.bot else [opponent, ctx.author]
        await self.base_minigame_cmd(TicTacToeGame, ctx, players, opponent.bot)

    @commands.hybrid_command(name="connect4", aliases=["c4"])
    @app_commands.describe(opponent="Invite another officer to play.")
    @commands.guild_only()
    async def connectfour(self, ctx: commands.Context, opponent: Optional[discord.Member] = None):
        """
        Play a game of Connect 4 against the bot or another officer.
        """
        assert ctx.guild and isinstance(ctx.author, discord.Member) and isinstance(ctx.channel, (discord.abc.GuildChannel, discord.Thread))
        opponent = opponent or ctx.guild.me
        players = [ctx.author, opponent] if opponent.bot else [opponent, ctx.author]
        await self.base_minigame_cmd(ConnectFourGame, ctx, players, opponent.bot)

    async def base_minigame_cmd(self,
                                game_cls: Type[Minigame],
                                ctx: Union[commands.Context, discord.Interaction],
                                players: List[discord.Member],
                                against_bot: bool,
                                ):
        author = ctx.author if isinstance(ctx, commands.Context) else ctx.user
        reply = ctx.reply if isinstance(ctx, commands.Context) else ctx.response.send_message
        assert ctx.guild and isinstance(ctx.channel, discord.abc.Messageable) and isinstance(ctx.channel, (discord.abc.GuildChannel, discord.Thread)) and isinstance(author, discord.Member)

        entry = await self.entry_fee(ctx.guild) if await self.is_economy_enabled(ctx.guild) else 0

        # Affordability first: an invitation for a game nobody can pay for is
        # worse than a refusal, because it costs the other officer a decision.
        if entry > 0:
            for player in players:
                if player.bot:
                    continue
                if not await bank.can_spend(player, entry):
                    who = "You don't" if player == author else f"{player.display_name} doesn't"
                    return await reply(
                        f"💰 The entry is **{entry:,} donuts** and {who} have enough.",
                        allowed_mentions=discord.AllowedMentions.none(),
                    )

        # Game already exists
        if ctx.channel.id in self.games and not self.games[ctx.channel.id].is_finished():
            old_game = self.games[ctx.channel.id]
            old_message = await ctx.channel.fetch_message(old_game.message.id) if old_game.message else None # re-fetch
            # Games only exist as long as their message is alive
            if old_message:
                seconds_passed = int((datetime.now() - old_game.last_interacted).total_seconds())
                if seconds_passed // 60 >= TIME_LIMIT:
                    async def callback():
                        nonlocal ctx, players, old_game, against_bot, entry
                        assert isinstance(author, discord.Member) and isinstance(ctx.channel, discord.abc.Messageable) and isinstance(ctx.channel, (discord.abc.GuildChannel, discord.Thread))
                        await old_game.cancel(author)
                        game = game_cls(self, players, ctx.channel, entry)
                        if against_bot:
                            game.accept(author)
                            await game.init()
                        self.games[ctx.channel.id] = game
                        message = await ctx.channel.send(content=await game.get_content(), embed=await game.get_embed(), view=await game.get_view())
                        game.message = message
                        if old_game.message:
                            try:
                                await old_game.message.delete()
                            except discord.NotFound:
                                pass

                    content = f"Someone else is playing a game in this channel, here: {old_message.jump_url}, " \
                              f"but {humanize_timedelta(seconds=seconds_passed)} have passed since their last interaction. Do you want to start a new game?"
                    embed = discord.Embed(title="Confirmation", description=content, color=await self.bot.get_embed_color(ctx.channel))
                    view = ReplaceView(self, callback, author)
                    message = await reply(embed=embed, view=view)
                    view.message = message if isinstance(ctx, commands.Context) else await ctx.original_response() # type: ignore
                    return

                else:
                    content = f"There is still an active game in this channel, here: {old_message.jump_url}\nTry again in a few minutes"
                    permissions = ctx.channel.permissions_for(author)
                    content += " or consider creating a thread." if permissions.create_public_threads or permissions.create_private_threads else "."
                    await reply(content, ephemeral=True)
                    return

        # New game
        game = game_cls(self, players, ctx.channel, entry)
        if against_bot:
            game.accept(author)
            await game.init()
        self.games[ctx.channel.id] = game
        message = await reply(content=await game.get_content(), embed=await game.get_embed(), view=await game.get_view())
        game.message = message if isinstance(ctx, commands.Context) else await ctx.original_response() # type: ignore

    # ----------------------------------------------------------------- #
    # Settings                                                          #
    # ----------------------------------------------------------------- #

    @commands.group(name="minigamesset", aliases=["mgset", "connect4set", "c4set", "tictactoeset", "tttset"], invoke_without_command=True)  # type: ignore
    @commands.guild_only()
    @checks.admin_or_permissions(manage_guild=True)
    @bank.is_owner_if_bank_global()
    async def minigamesset(self, ctx: commands.Context):
        """Settings for Connect 4 and Tic-Tac-Toe."""
        assert ctx.guild
        entry = await self.entry_fee(ctx.guild)
        bot_pays = await self.bot_pays_entry(ctx.guild)
        pot = entry * 2 if bot_pays else entry
        crackpot = "loaded" if self.bot.get_cog("CrackPot") else "**not loaded** — lost pots vanish instead"
        embed = discord.Embed(
            title="🕹️ Minigames",
            colour=await ctx.embed_colour(),
            description="\n".join([
                f"**Entry fee:** {entry:,} 🍩 per player" if entry else "**Entry fee:** free (games pay nothing)",
                f"**I pay in too:** {'yes' if bot_pays else 'no'}",
                f"**Winner takes:** {pot:,} 🍩" if entry else "**Winner takes:** —",
                f"**Lost pots:** into the crack pot ({crackpot})",
                "",
                f"`{ctx.clean_prefix}minigamesset entry <amount>` · "
                f"`{ctx.clean_prefix}minigamesset botentry <true|false>`",
            ]),
        )
        await ctx.send(embed=embed)

    @minigamesset.command(name="entry", aliases=["fee", "buyin", "payout", "prize"])
    async def minigamesset_entry(self, ctx: commands.Context, amount: Optional[int]):
        """Show or set the entry fee every player pays. 0 turns the money off."""
        assert ctx.guild
        is_global = await bank.is_global()
        setting = self.config.entry_fee if is_global else self.config.guild(ctx.guild).entry_fee
        if amount is None:
            return await ctx.send(f"The entry fee is **{await setting():,} donuts** per player.")
        if amount < 0:
            return await ctx.send("The entry fee must be 0 or more.")
        await setting.set(amount)
        if amount == 0:
            return await ctx.send("Games are free now, and nothing is paid out.")
        pot = amount * 2 if await self.bot_pays_entry(ctx.guild) else amount
        await ctx.send(f"Entry fee is **{amount:,} donuts** per player — the winner takes **{pot:,}**.")

    @minigamesset.command(name="botentry", aliases=["botpays"])
    async def minigamesset_botentry(self, ctx: commands.Context, pays: Optional[bool]):
        """Show or set whether I pay an entry fee as well.

        On, the house stakes on my behalf, so beating me is worth a real pot.
        Off, a game against me is practice: win and you get your own entry back.
        """
        assert ctx.guild
        is_global = await bank.is_global()
        setting = self.config.bot_pays_entry if is_global else self.config.guild(ctx.guild).bot_pays_entry
        if pays is None:
            current = await setting()
            return await ctx.send(f"I {'pay' if current else 'do not pay'} an entry fee.")
        await setting.set(pays)
        entry = await self.entry_fee(ctx.guild)
        if pays:
            await ctx.send(f"I pay in too — a game against me has a **{entry * 2:,} donut** pot.")
        else:
            await ctx.send(f"I no longer pay in — a game against me has a **{entry:,} donut** pot.")
