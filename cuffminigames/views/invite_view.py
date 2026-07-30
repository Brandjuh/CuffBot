import discord
from redbot.core import bank

from cuffminigames.base import Minigame

MAX_BUTTON_LABEL = 80


class InviteView(discord.ui.View):
    """Accept / Cancel on a pending challenge.

    Forked from crab-cogs. The button used to read "Accept and bet N <currency>"
    off a currency name the caller had to look up and strip emoji out of; the
    entry fee is a fixed precinct setting now, so the view reads it off the game
    and the caller passes nothing.
    """

    def __init__(self, game: Minigame):
        super().__init__(timeout=None)
        self.game = game
        label = "Accept" if game.entry <= 0 else f"Accept and pay {game.entry:,} donuts"[:MAX_BUTTON_LABEL]
        accept_button = discord.ui.Button(label=label, style=discord.ButtonStyle.primary)
        cancel_button = discord.ui.Button(label="Cancel", style=discord.ButtonStyle.secondary)
        accept_button.callback = self.accept
        cancel_button.callback = self.cancel
        self.add_item(accept_button)
        self.add_item(cancel_button)

    async def accept(self, interaction: discord.Interaction):
        assert isinstance(interaction.user, discord.Member)
        if interaction.user != self.game.players[0]:
            return await interaction.response.send_message("You're not the target of this invitation!", ephemeral=True)
        if self.game.entry > 0:
            # Checked again here rather than trusted from command time: the two
            # can be minutes apart, and starting a game somebody cannot pay for
            # is how the pot ends up short.
            for player in self.game.players:
                if player.bot:
                    continue
                if not await bank.can_spend(player, self.game.entry):
                    content = f"{player.mention} can't cover the {self.game.entry:,} donut entry!"
                    return await interaction.response.send_message(content, allowed_mentions=discord.AllowedMentions.none())
        self.game.accept(interaction.user)
        await self.game.init()
        await interaction.response.edit_message(content=await self.game.get_content(), embed=await self.game.get_embed(), view=await self.game.get_view())

    async def cancel(self, interaction: discord.Interaction):
        assert isinstance(interaction.user, discord.Member)
        if interaction.user not in self.game.players:
            return await interaction.response.send_message("You're not the target of this invitation!", ephemeral=True)
        await self.game.cancel(interaction.user)
        self.stop()
        assert interaction.message
        await interaction.message.delete()
