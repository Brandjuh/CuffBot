import discord
from typing import Optional

from cuffminigames.base import Minigame

MAX_BUTTON_LABEL = 80


class RematchView(discord.ui.View):
    """The button under a finished game.

    Forked from crab-cogs. The rematch no longer carries a bet forward — it
    starts a fresh game at whatever the precinct's entry fee is *now*, which is
    also what stops a rematch from charging yesterday's price after an admin
    changed it.
    """

    def __init__(self, game: Minigame):
        super().__init__(timeout=300)
        self.game = game
        self.message: Optional[discord.Message] = None
        self.rematch_button = None
        if not self.game.is_cancelled():
            label = "Rematch" if game.entry <= 0 else f"Rematch — {game.entry:,} donuts"[:MAX_BUTTON_LABEL]
            self.rematch_button = discord.ui.Button(label=label, style=discord.ButtonStyle.green, row=4)
            self.rematch_button.callback = self.rematch
            self.add_item(self.rematch_button)

    async def rematch(self, interaction: discord.Interaction):
        assert interaction.message and isinstance(interaction.user, discord.Member)
        if interaction.user not in self.game.players:
            return await interaction.response.send_message("You didn't play this game! You should start a new one.", ephemeral=True)

        opponent = [player for player in self.game.players if player != interaction.user][0]
        players = [interaction.user, opponent] if opponent.bot else [opponent, interaction.user]

        self.stop()
        await self.game.cog.base_minigame_cmd(type(self.game), interaction, players, opponent.bot)
        await self.on_timeout()

    async def on_timeout(self):
        if self.message:
            if self.rematch_button:
                self.remove_item(self.rematch_button)
            try:
                await self.message.edit(view=self)
            except discord.NotFound:
                pass
