"""Discord UI components: the persistent game view, modals, and confirmations.

Every component carries a deterministic custom ID of the form
``enigmic:<action>:<game_id>`` so views can be re-registered for their
messages after a cog reload or bot restart.  The components hold no game
state of their own - every interaction resolves the game from the cog's
storage, which keeps reloads and concurrent clicks safe.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Awaitable, Callable

import discord

from .constants import Role
from .coordinates import format_coordinate
from .models import ActiveGame, Case

if TYPE_CHECKING:
    from .enigmic import Enigmic

log = logging.getLogger("red.cuffbotred.enigmic.views")


class GameButton(discord.ui.Button["EnigmicGameView"]):
    """A control button that forwards its action to the cog."""

    def __init__(
        self,
        action: str,
        label: str,
        style: discord.ButtonStyle,
        row: int,
        game_id: str,
        *,
        disabled: bool = False,
    ) -> None:
        super().__init__(
            label=label,
            style=style,
            row=row,
            custom_id=f"enigmic:{action}:{game_id}",
            disabled=disabled,
        )
        self.action = action

    async def callback(self, interaction: discord.Interaction) -> None:
        assert self.view is not None
        await self.view.cog.handle_view_action(
            interaction, self.view.game_id, self.action
        )


class CharacterSelect(discord.ui.Select["EnigmicGameView"]):
    """Selects which character subsequent actions apply to."""

    def __init__(self, game: ActiveGame, case: Case, game_id: str) -> None:
        options = []
        for character in case.characters:
            placed_cell = game.placements.get(character.id)
            role = "Victim" if character.role is Role.VICTIM else "Suspect"
            if placed_cell is not None:
                description = f"{role} [{character.symbol}] - placed at " \
                              f"{format_coordinate(placed_cell)}"
            else:
                description = f"{role} [{character.symbol}] - not placed"
            options.append(
                discord.SelectOption(
                    label=character.name[:100],
                    value=character.id,
                    description=description[:100],
                    default=character.id == game.selected_character_id,
                )
            )
        super().__init__(
            placeholder="Select a character...",
            options=options,
            row=0,
            custom_id=f"enigmic:select:{game_id}",
        )

    async def callback(self, interaction: discord.Interaction) -> None:
        assert self.view is not None
        await self.view.cog.handle_character_select(
            interaction, self.view.game_id, self.values[0]
        )


class EnigmicGameView(discord.ui.View):
    """The persistent control panel attached to a game message."""

    def __init__(
        self,
        cog: "Enigmic",
        game: ActiveGame,
        case: Case,
        *,
        disabled: bool = False,
    ) -> None:
        super().__init__(timeout=None)
        self.cog = cog
        self.game_id = game.game_id

        self.add_item(CharacterSelect(game, case, self.game_id))
        secondary = discord.ButtonStyle.secondary
        layout = [
            ("place", "Place", discord.ButtonStyle.primary, 1),
            ("remove", "Remove", secondary, 1),
            ("mark", "Mark X", secondary, 1),
            ("note", "Note", secondary, 1),
            ("clear", "Clear Mark", secondary, 1),
            ("undo", "Undo", secondary, 2),
            ("hint", "Hint", secondary, 2),
            ("refresh", "Refresh", secondary, 2),
            ("submit", "Submit", discord.ButtonStyle.success, 3),
            ("rules", "Rules", secondary, 3),
            ("abandon", "Abandon", discord.ButtonStyle.danger, 3),
        ]
        for action, label, style, row in layout:
            self.add_item(
                GameButton(action, label, style, row, self.game_id, disabled=disabled)
            )
        if disabled:
            for item in self.children:
                item.disabled = True

    async def on_error(
        self,
        interaction: discord.Interaction,
        error: Exception,
        item: discord.ui.Item,
    ) -> None:
        await self.cog.handle_view_error(interaction, error)


class CoordinateModal(discord.ui.Modal):
    """A one-field modal asking for a grid coordinate such as B4."""

    def __init__(
        self,
        title: str,
        size: int,
        callback: Callable[[discord.Interaction, str], Awaitable[None]],
    ) -> None:
        # Discord keeps a modal usable for the full 15-minute interaction
        # token lifetime; a shorter timeout drops the player's submission.
        super().__init__(title=title[:45], timeout=15 * 60)
        last = f"{'ABCDEFGH'[size - 1]}{size}"
        self.coordinate: discord.ui.TextInput = discord.ui.TextInput(
            label=f"Coordinate (A1 to {last})",
            placeholder=f"For example B2 - column letter A-{'ABCDEFGH'[size - 1]}, "
                        f"row number 1-{size}",
            min_length=2,
            max_length=4,
            required=True,
        )
        self.add_item(self.coordinate)
        self._callback = callback

    async def on_submit(self, interaction: discord.Interaction) -> None:
        await self._callback(interaction, str(self.coordinate.value))


class ConfirmView(discord.ui.View):
    """A yes/no confirmation restricted to one user."""

    def __init__(self, author_id: int, *, timeout: float = 60.0) -> None:
        super().__init__(timeout=timeout)
        self.author_id = author_id
        self.value: bool | None = None

    async def on_error(
        self,
        interaction: discord.Interaction,
        error: Exception,
        item: discord.ui.Item,
    ) -> None:
        log.exception("Confirmation view failed", exc_info=error)
        self.value = False
        self.stop()

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                "This confirmation is not for you.", ephemeral=True
            )
            return False
        return True

    @discord.ui.button(label="Confirm", style=discord.ButtonStyle.danger)
    async def confirm(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        self.value = True
        await interaction.response.defer()
        self.stop()

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary)
    async def cancel(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        self.value = False
        await interaction.response.defer()
        self.stop()


class NextCaseView(discord.ui.View):
    """Shown on a completed game; offers to start the next case.

    Set :attr:`message` after sending so the button visibly greys out when
    the view times out.
    """

    def __init__(self, cog: "Enigmic", player_id: int) -> None:
        super().__init__(timeout=3600)
        self.cog = cog
        self.player_id = player_id
        self.message: discord.Message | None = None

    @discord.ui.button(label="Next Case", style=discord.ButtonStyle.primary)
    async def next_case(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        if interaction.user.id != self.player_id:
            await interaction.response.send_message(
                "This puzzle belongs to another player. Start your own game "
                "with /enigmic start.",
                ephemeral=True,
            )
            return
        await self.cog.handle_next_case(interaction)

    async def on_error(
        self,
        interaction: discord.Interaction,
        error: Exception,
        item: discord.ui.Item,
    ) -> None:
        await self.cog.handle_view_error(interaction, error)

    async def on_timeout(self) -> None:
        for item in self.children:
            item.disabled = True
        if self.message is not None:
            try:
                await self.message.edit(view=self)
            except discord.HTTPException:
                pass
