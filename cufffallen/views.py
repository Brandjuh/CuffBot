"""Buttons, dropdowns and modals for the submission and review flow.

Two kinds of component live here, and they persist very differently:

* **The panel button and the review buttons must outlive a restart.** They
  carry deterministic custom IDs (``cufffallen:panel:submit`` and
  ``cufffallen:review:<id>:<action>``) and hold no state of their own — every
  press resolves the submission out of the cog's config, so a reload, a second
  admin clicking at the same moment and a stale message all behave.
* **Everything a member sees while writing is ephemeral and in memory.** The
  agency dropdown, the modal and the preview belong to one private message and
  one sitting. A restart mid-draft loses the draft, which is the honest
  outcome: nothing was submitted, so nothing was promised.

Every modal in this file is opened from a component, so its submit response is
allowed to edit the message the component sat on. That is what keeps the whole
member flow inside a single private message instead of a trail of them.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any, Dict, Optional

import discord

from .submission import (
    AGENCY_ORDER,
    AGENCIES,
    MAX_EOW,
    MAX_NAME,
    MAX_TEXT,
    MAX_URL,
    agency_for,
)

if TYPE_CHECKING:
    from .cufffallen import CuffFallen

log = logging.getLogger("red.cuff-cogs.cufffallen.views")

PANEL_BUTTON_ID = "cufffallen:panel:submit"
REVIEW_PREFIX = "cufffallen:review:"


# ----------------------------------------------------------------------
# The panel
# ----------------------------------------------------------------------


class PanelView(discord.ui.View):
    """The permanent "Submit Fallen Hero" button in the information channel."""

    def __init__(self, cog: "CuffFallen") -> None:
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(
        label="Submit Fallen Hero",
        style=discord.ButtonStyle.primary,
        emoji="🕯️",
        custom_id=PANEL_BUTTON_ID,
    )
    async def submit(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await self.cog.start_submission(interaction)


# ----------------------------------------------------------------------
# Writing a submission
# ----------------------------------------------------------------------


class AgencySelect(discord.ui.Select):
    """Which service the fallen belonged to.

    A dropdown rather than a fifth modal field: the agency decides which role
    gets tagged in front of the whole guild, so it is picked from the four
    that exist instead of typed.
    """

    def __init__(self, current: Optional[str], *, then: str) -> None:
        options = [
            discord.SelectOption(
                label=AGENCIES[key].label,
                value=key,
                emoji=AGENCIES[key].emoji,
                description=AGENCIES[key].blurb[:100],
                default=key == current,
            )
            for key in AGENCY_ORDER
        ]
        super().__init__(placeholder="Which agency did they serve?", options=options, row=0)
        self.then = then

    async def callback(self, interaction: discord.Interaction) -> None:
        view: "AgencySelectView" = self.view  # type: ignore[assignment]
        await view.cog.agency_chosen(interaction, view.draft, self.values[0], then=self.then)


class AgencySelectView(discord.ui.View):
    """Step one of a new submission, and the "change agency" step of an edit."""

    def __init__(self, cog: "CuffFallen", draft: Dict[str, Any], *, then: str) -> None:
        super().__init__(timeout=900)
        self.cog = cog
        self.draft = draft
        self.add_item(AgencySelect(draft.get("agency"), then=then))


class DetailsModal(discord.ui.Modal):
    """The five written fields — a modal's maximum. The agency is already
    chosen by this point, which is what makes the fifth slot free for the
    End of watch.

    ``max_length`` on every field is Discord enforcing the limits for us —
    a member finds out they are over while typing, not after submitting.
    """

    def __init__(self, cog: "CuffFallen", draft: Dict[str, Any]) -> None:
        agency = agency_for(draft.get("agency"))
        super().__init__(title=f"Fallen Hero — {agency.label}"[:45], timeout=1800)
        self.cog = cog
        self.draft = draft

        self.name_field = discord.ui.TextInput(
            label="Name of the fallen",
            placeholder="Firefighter John Doe",
            max_length=MAX_NAME,
            default=draft.get("name") or None,
            required=True,
        )
        self.eow_field = discord.ui.TextInput(
            label="End of watch (optional)",
            placeholder="The date they died: 2026-08-03, or August 3, 2026",
            max_length=MAX_EOW,
            default=draft.get("eow") or None,
            required=False,
        )
        self.source_field = discord.ui.TextInput(
            label="Link to source",
            placeholder="https://www.odmp.org/officer/…",
            max_length=MAX_URL,
            default=draft.get("source") or None,
            required=True,
        )
        self.text_field = discord.ui.TextInput(
            label="Message",
            style=discord.TextStyle.paragraph,
            placeholder="Their story. Discord markdown works here.",
            max_length=MAX_TEXT,
            default=draft.get("text") or None,
            required=True,
        )
        self.photo_field = discord.ui.TextInput(
            label="Link to a photo (optional)",
            placeholder="https://…/portrait.jpg — must be a direct image link",
            max_length=MAX_URL,
            default=draft.get("photo") or None,
            required=False,
        )
        for item in (
            self.name_field,
            self.eow_field,
            self.source_field,
            self.text_field,
            self.photo_field,
        ):
            self.add_item(item)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        await self.cog.details_submitted(
            interaction,
            self.draft,
            name=str(self.name_field.value),
            eow=str(self.eow_field.value or ""),
            source=str(self.source_field.value),
            text=str(self.text_field.value),
            photo=str(self.photo_field.value or ""),
        )

    async def on_error(self, interaction: discord.Interaction, error: Exception) -> None:
        log.exception("cufffallen: details modal failed", exc_info=error)
        await _complain(interaction, "Something went wrong saving that. Nothing was submitted.")


class PreviewView(discord.ui.View):
    """What the member sees before anyone else does.

    The preview is the validation: the embed above these buttons is byte for
    byte what the admins will be asked to approve, so a photo link that is not
    an image, or markdown that did not do what was intended, is visible here
    while it can still be fixed.
    """

    def __init__(self, cog: "CuffFallen", draft: Dict[str, Any]) -> None:
        super().__init__(timeout=900)
        self.cog = cog
        self.draft = draft

    @discord.ui.button(label="Edit", style=discord.ButtonStyle.secondary, emoji="✏️", row=0)
    async def edit(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await interaction.response.send_modal(DetailsModal(self.cog, self.draft))

    @discord.ui.button(label="Change agency", style=discord.ButtonStyle.secondary, row=0)
    async def change_agency(
        self, interaction: discord.Interaction, button: discord.ui.Button
    ) -> None:
        await interaction.response.edit_message(
            content="Which agency did they serve?",
            embed=None,
            view=AgencySelectView(self.cog, self.draft, then="preview"),
        )

    @discord.ui.button(
        label="Submit for approval", style=discord.ButtonStyle.success, emoji="📨", row=1
    )
    async def send(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        await self.cog.submit_for_approval(interaction, self.draft)

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.danger, row=1)
    async def cancel(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        self.cog.drop_draft(interaction)
        await interaction.response.edit_message(
            content="Cancelled. Nothing was sent to the admins.", embed=None, view=None
        )


# ----------------------------------------------------------------------
# Reviewing a submission
# ----------------------------------------------------------------------


class ReviewButton(discord.ui.Button):
    """One admin decision, addressed to a stored submission by id."""

    def __init__(self, action: str, label: str, style: discord.ButtonStyle, emoji: str, sub_id: str):
        super().__init__(
            label=label,
            style=style,
            emoji=emoji,
            custom_id=f"{REVIEW_PREFIX}{sub_id}:{action}",
            row=1,
        )
        self.action = action
        self.sub_id = sub_id

    async def callback(self, interaction: discord.Interaction) -> None:
        view: "ReviewView" = self.view  # type: ignore[assignment]
        await view.cog.handle_review_action(interaction, self.sub_id, self.action)


class ReviewAgencySelect(discord.ui.Select):
    """The agency, changeable in place on the review message.

    This lives here rather than in the edit modal because a modal holds five
    fields and the written ones need all five. It is the better home anyway:
    the agency decides which role gets pinged, so admins pick it from the
    four that exist — same rule as the member flow.
    """

    def __init__(self, sub_id: str, current: Optional[str]) -> None:
        options = [
            discord.SelectOption(
                label=f"Agency: {AGENCIES[key].label}",
                value=key,
                emoji=AGENCIES[key].emoji,
                default=key == current,
            )
            for key in AGENCY_ORDER
        ]
        super().__init__(
            options=options,
            row=0,
            custom_id=f"{REVIEW_PREFIX}{sub_id}:agencypick",
        )
        self.sub_id = sub_id

    async def callback(self, interaction: discord.Interaction) -> None:
        view: "ReviewView" = self.view  # type: ignore[assignment]
        await view.cog.review_agency_set(interaction, self.sub_id, self.values[0])


class ReviewView(discord.ui.View):
    """The agency picker over Approve / Edit / Deny, re-registered for every
    pending submission on load."""

    def __init__(self, cog: "CuffFallen", sub_id: str, agency: Optional[str] = None) -> None:
        super().__init__(timeout=None)
        self.cog = cog
        self.sub_id = sub_id
        self.add_item(ReviewAgencySelect(sub_id, agency))
        self.add_item(ReviewButton("approve", "Approve", discord.ButtonStyle.success, "✅", sub_id))
        self.add_item(ReviewButton("edit", "Edit", discord.ButtonStyle.secondary, "✏️", sub_id))
        self.add_item(ReviewButton("deny", "Deny", discord.ButtonStyle.danger, "🚫", sub_id))


class AdminEditModal(discord.ui.Modal):
    """An admin's correction of a pending submission.

    The same five written fields the member filled in. The agency is *not*
    here — five fields is a modal's ceiling and the review message carries an
    agency dropdown of its own, one click instead of a modal round-trip.
    """

    def __init__(self, cog: "CuffFallen", sub_id: str, submission: Dict[str, Any]) -> None:
        super().__init__(title="Edit submission", timeout=1800)
        self.cog = cog
        self.sub_id = sub_id

        self.name_field = discord.ui.TextInput(
            label="Name of the fallen",
            max_length=MAX_NAME,
            default=submission.get("name") or None,
            required=True,
        )
        self.eow_field = discord.ui.TextInput(
            label="End of watch (optional)",
            placeholder="2026-08-03, or August 3, 2026",
            max_length=MAX_EOW,
            default=submission.get("eow") or None,
            required=False,
        )
        self.source_field = discord.ui.TextInput(
            label="Link to source",
            max_length=MAX_URL,
            default=submission.get("source") or None,
            required=True,
        )
        self.text_field = discord.ui.TextInput(
            label="Message",
            style=discord.TextStyle.paragraph,
            max_length=MAX_TEXT,
            default=submission.get("text") or None,
            required=True,
        )
        self.photo_field = discord.ui.TextInput(
            label="Link to a photo (optional)",
            max_length=MAX_URL,
            default=submission.get("photo") or None,
            required=False,
        )
        for item in (
            self.name_field,
            self.eow_field,
            self.source_field,
            self.text_field,
            self.photo_field,
        ):
            self.add_item(item)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        await self.cog.admin_edit_submitted(
            interaction,
            self.sub_id,
            name=str(self.name_field.value),
            eow=str(self.eow_field.value or ""),
            source=str(self.source_field.value),
            text=str(self.text_field.value),
            photo=str(self.photo_field.value or ""),
        )

    async def on_error(self, interaction: discord.Interaction, error: Exception) -> None:
        log.exception("cufffallen: admin edit modal failed", exc_info=error)
        await _complain(interaction, "That edit did not go through. The submission is unchanged.")


class DenyModal(discord.ui.Modal):
    """Why it was turned down. The reason is what the member is told."""

    def __init__(self, cog: "CuffFallen", sub_id: str) -> None:
        super().__init__(title="Deny submission", timeout=1800)
        self.cog = cog
        self.sub_id = sub_id
        self.reason_field = discord.ui.TextInput(
            label="Reason (sent to the submitter)",
            style=discord.TextStyle.paragraph,
            placeholder="What would make this publishable?",
            max_length=1000,
            required=False,
        )
        self.add_item(self.reason_field)

    async def on_submit(self, interaction: discord.Interaction) -> None:
        await self.cog.deny_submitted(
            interaction, self.sub_id, reason=str(self.reason_field.value or "")
        )

    async def on_error(self, interaction: discord.Interaction, error: Exception) -> None:
        log.exception("cufffallen: deny modal failed", exc_info=error)
        await _complain(interaction, "That did not go through. The submission is still pending.")


async def _complain(interaction: discord.Interaction, message: str) -> None:
    """Tell the clicker privately, whether or not the interaction was answered."""
    try:
        if interaction.response.is_done():
            await interaction.followup.send(message, ephemeral=True)
        else:
            await interaction.response.send_message(message, ephemeral=True)
    except discord.HTTPException:
        pass
