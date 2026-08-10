"""CuffFallen — members submit a fallen hero, admins approve it, the guild sees it.

``cuffmemorial`` honours the fallen the feeds report. This cog honours the ones
they miss: a member writes the memorial themselves from a panel in the server
information channel, and it reaches <#451095508560379934> only once an admin
has said so.

The route a submission takes, and why each step is where it is:

1. **Panel button → agency dropdown → modal.** The agency is picked from four
   options rather than typed, because it decides which role gets tagged in
   front of the whole guild. That leaves four written fields, inside a modal's
   limit of five with room to spare.
2. **Preview before anyone else sees it.** The member gets the finished embed
   back privately with Edit / Change agency / Submit / Cancel. The preview is
   the validation: a photo link that is not really an image shows up as a
   missing picture here, while it can still be fixed.
3. **Review post in <#411637334778576896>.** Approve, Deny (with a reason the
   member is told) or Edit — an admin can fix a typo instead of bouncing a
   memorial back over one.
4. **Published, with the ping the agency deserves.** Police, fire and
   corrections each tag the precinct's existing memorial role — the same roles
   ``cuffmemorial`` tags — and ambulance publishes silently, because this guild
   has no EMS role to call.

**Test mode** (admins only) sends both the review post and the published post
to <#412334189879230474> instead, coloured and footered as a test. The flag is
stamped on the submission when it is sent, not read again at approval time: a
submission written as a test stays a test even if someone flips the switch
while it sits in the queue, so a rehearsal can never surface in the real
memorial channel.
"""

from __future__ import annotations

import asyncio
import io
import logging
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import aiohttp
import discord
from redbot.core import Config, checks, commands
from redbot.core.bot import Red

from .photo import USER_AGENT, fetch_photo, looks_expiring

from .submission import (
    AGENCIES,
    AGENCY_ORDER,
    APPROVED_COLOR,
    DENIED_COLOR,
    MEMORIAL_COLOR,
    PENDING_COLOR,
    TEST_COLOR,
    agency_for,
    clean_url,
    clip,
    eow_problem,
    format_eow,
    looks_like_image,
    memorial_embed,
    parse_agency,
    parse_eow,
    role_id_for,
)
from .views import (
    AdminEditModal,
    AgencySelectView,
    DenyModal,
    DetailsModal,
    PanelView,
    PreviewView,
    ReviewView,
)

log = logging.getLogger("red.cuff-cogs.cufffallen")

#: Owner's channels (2026-08-10). All four are stored in config as well, so
#: they can be moved without a code change; these are what a fresh install
#: starts on.
PANEL_CHANNEL_ID = 670776730570719232  # server information
PUBLISH_CHANNEL_ID = 451095508560379934  # fallen heroes — same as cuffmemorial
REVIEW_CHANNEL_ID = 411637334778576896  # admin review queue
TEST_CHANNEL_ID = 412334189879230474  # everything test mode touches

#: How many submissions one member may have waiting on the admins at once.
#: Not a punishment — it keeps one enthusiastic evening from burying the queue.
DEFAULT_MAX_PENDING = 3
#: Decided submissions are kept as a record, but not forever.
KEEP_DECIDED = 50

STATUS_LABELS = {
    "pending": "⏳ Pending review",
    "approved": "✅ Approved",
    "denied": "🚫 Denied",
    "cancelled": "✖️ Cancelled",
}


class CuffFallen(commands.Cog):
    """Member-submitted memorials for the fallen, published after admin approval."""

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175021, force_registration=True)
        self.config.register_guild(
            enabled=True,
            panel_channel_id=PANEL_CHANNEL_ID,
            panel_message_id=None,
            review_channel_id=REVIEW_CHANNEL_ID,
            publish_channel_id=PUBLISH_CHANNEL_ID,
            test_channel_id=TEST_CHANNEL_ID,
            #: Admin-only switch. Read once, when a submission is sent.
            test_mode=False,
            #: A rehearsal that pings a whole role is not a rehearsal. Off
            #: unless an admin explicitly wants the ping tested too.
            test_ping=False,
            #: Name the member who wrote it in the published footer.
            credit_submitter=True,
            #: agency key -> role id override (0 = never ping for this agency).
            role_ids={},
            max_pending=DEFAULT_MAX_PENDING,
            #: submission id (str) -> record. Pending ones are live state;
            #: decided ones are the audit trail, pruned to KEEP_DECIDED.
            submissions={},
            next_id=1,
        )
        #: (guild_id, user_id) -> draft. Deliberately RAM-only: a draft is one
        #: private message in one sitting, and nothing has been promised yet.
        #: Keys starting with ``_`` (the mirrored photo bytes) never reach
        #: config — the stored submission is built field by field.
        self._drafts: Dict[Tuple[int, int], Dict[str, Any]] = {}
        self._locks: Dict[str, asyncio.Lock] = {}
        self._registered: set = set()
        self._session: Optional[aiohttp.ClientSession] = None

    async def cog_load(self) -> None:
        """Re-adopt the panel button and every pending review message.

        Without this the buttons on messages posted before the last restart
        answer "This interaction failed" forever.
        """
        self.bot.add_view(PanelView(self))
        try:
            everything = await self.config.all_guilds()
        except Exception:  # pragma: no cover — config unavailable at boot
            log.exception("cufffallen: could not read config on load")
            return
        for guild_id, conf in everything.items():
            for sub_id, sub in (conf.get("submissions") or {}).items():
                if sub.get("status") != "pending" or not sub.get("review_message_id"):
                    continue
                key = f"{guild_id}:{sub_id}"
                if key in self._registered:
                    continue
                self.bot.add_view(
                    ReviewView(self, str(sub_id), sub.get("agency")),
                    message_id=int(sub["review_message_id"]),
                )
                self._registered.add(key)

    async def cog_unload(self) -> None:
        self._drafts.clear()
        if self._session is not None:
            asyncio.create_task(self._session.close())

    async def session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(headers={"User-Agent": USER_AGENT})
        return self._session

    async def red_delete_data_for_user(self, *, requester: str, user_id: int) -> None:
        """Forget who wrote what.

        A published memorial belongs to the person it honours and stays where
        it is; the submitter's id is what this cog holds, so pending
        submissions from that member are cancelled and decided ones lose the
        author. The record of the decision survives — admins need it.
        """
        for guild in self.bot.guilds:
            async with self.config.guild(guild).submissions() as subs:
                for sub in subs.values():
                    if int(sub.get("user_id") or 0) != int(user_id):
                        continue
                    if sub.get("status") == "pending":
                        sub["status"] = "cancelled"
                        sub["reason"] = "Submitter's data was deleted."
                    sub["user_id"] = None
                    sub["user_name"] = "[deleted]"
            self._drafts.pop((guild.id, int(user_id)), None)

    # ------------------------------------------------------------------
    # Small helpers
    # ------------------------------------------------------------------

    def _lock(self, guild_id: int, sub_id: str) -> asyncio.Lock:
        """One lock per submission: two admins can click Approve together."""
        return self._locks.setdefault(f"{guild_id}:{sub_id}", asyncio.Lock())

    async def is_admin(self, member: Any) -> bool:
        """Red's admins, guild managers and the bot owner — nobody else."""
        if member is None:
            return False
        if await self.bot.is_owner(member):
            return True
        if not isinstance(member, discord.Member):
            return False
        perms = member.guild_permissions
        if perms.administrator or perms.manage_guild:
            return True
        return await self.bot.is_admin(member)

    @staticmethod
    def _channel(guild: discord.Guild, channel_id: Optional[int]) -> Optional[discord.TextChannel]:
        if not channel_id:
            return None
        channel = guild.get_channel(int(channel_id))
        return channel if isinstance(channel, (discord.TextChannel, discord.Thread)) else None

    async def target_channels(
        self, guild: discord.Guild, *, test: bool
    ) -> Tuple[Optional[discord.abc.Messageable], Optional[discord.abc.Messageable]]:
        """(review channel, publish channel) for a submission of this kind."""
        conf = await self.config.guild(guild).all()
        if test:
            test_channel = self._channel(guild, conf["test_channel_id"])
            return test_channel, test_channel
        return (
            self._channel(guild, conf["review_channel_id"]),
            self._channel(guild, conf["publish_channel_id"]),
        )

    def problems(self, draft: Dict[str, Any]) -> List[str]:
        """What still stops this from being sent. Empty means submittable."""
        found: List[str] = []
        if not str(draft.get("name") or "").strip():
            found.append("The name is empty.")
        if not str(draft.get("text") or "").strip():
            found.append("The message is empty.")
        if draft.get("agency") not in AGENCIES:
            found.append("No agency picked.")
        if not clean_url(draft.get("source")):
            found.append("The source link is not a working `http(s)://` link.")
        raw_photo = str(draft.get("photo") or "").strip()
        if raw_photo and not clean_url(raw_photo):
            found.append(
                "The photo link is not a working `http(s)://` link — fix it or clear the field."
            )
        date_complaint = eow_problem(draft.get("eow"))
        if date_complaint:
            found.append(date_complaint)
        return found

    def preview_note(self, draft: Dict[str, Any]) -> str:
        """The line under the preview: what is wrong, or what to check."""
        found = self.problems(draft)
        if found:
            return "**This cannot be sent yet:**\n" + "\n".join(f"• {line}" for line in found)
        lines = ["**This is exactly what will be posted.** Read it once more before you send it."]
        photo = clean_url(draft.get("photo"))
        if draft.get("_photo") is not None:
            lines.append(
                f"• Photo saved ({draft['_photo'].size_text}) — it is uploaded with the "
                "post itself, so it keeps working even after the link dies."
            )
        elif photo:
            # The link is being hotlinked, which means its lifetime is the
            # post's lifetime. Say how that is likely to go.
            why = draft.get("_photo_error")
            if why:
                lines.append(f"• ⚠️ The photo could not be downloaded: {why}.")
            if looks_expiring(photo):
                lines.append(
                    "• ⚠️ That photo link is **signed and will expire** (Facebook/CDN "
                    "links live days, not years) — the memorial would lose its picture. "
                    "Better: open the image, save it, upload it to Discord anywhere, "
                    "and paste that new link here instead."
                )
            elif not looks_like_image(photo):
                lines.append(
                    "• No picture above? Then that photo link is a page, not an image. "
                    "Right-click the image itself → *Copy image address*."
                )
        else:
            lines.append("• No photo — the post will be text only, which is fine.")
        return "\n".join(lines)

    async def mirror_photo(self, draft: Dict[str, Any]) -> None:
        """Fetch the draft's photo into ``_photo``, or record why not.

        Runs on every modal submit rather than caching by URL: the fetch is a
        couple of hundred kilobytes, and a stale copy of a corrected link is
        worse than the wait.
        """
        draft["_photo"] = None
        draft["_photo_error"] = None
        url = clean_url(draft.get("photo"))
        if not url:
            return
        photo, why = await fetch_photo(await self.session(), url)
        draft["_photo"] = photo
        draft["_photo_error"] = why

    # ------------------------------------------------------------------
    # Writing a submission
    # ------------------------------------------------------------------

    def drop_draft(self, interaction: discord.Interaction) -> None:
        if interaction.guild:
            self._drafts.pop((interaction.guild.id, interaction.user.id), None)

    async def start_submission(self, interaction: discord.Interaction) -> None:
        """Panel button: open the private workbench on the agency question."""
        guild = interaction.guild
        if guild is None:
            return
        conf = await self.config.guild(guild).all()
        if not conf["enabled"]:
            await interaction.response.send_message(
                "Submissions are closed at the moment. Ask an admin.", ephemeral=True
            )
            return

        pending = [
            sub
            for sub in (conf["submissions"] or {}).values()
            if sub.get("status") == "pending" and int(sub.get("user_id") or 0) == interaction.user.id
        ]
        if len(pending) >= int(conf["max_pending"]):
            await interaction.response.send_message(
                f"You already have {len(pending)} submission(s) waiting on the admins. "
                "Give those a decision first.",
                ephemeral=True,
            )
            return

        # An unsent draft is kept, so dismissing the modal by accident does not
        # cost someone the paragraph they just wrote.
        draft = self._drafts.setdefault(
            (guild.id, interaction.user.id),
            {"agency": None, "name": "", "eow": "", "source": "", "text": "", "photo": ""},
        )
        await interaction.response.send_message(
            content=(
                "**Submit a fallen hero.**\n"
                "Start with the service they belonged to — it decides who gets notified."
            ),
            view=AgencySelectView(self, draft, then="modal"),
            ephemeral=True,
        )

    async def agency_chosen(
        self, interaction: discord.Interaction, draft: Dict[str, Any], key: str, *, then: str
    ) -> None:
        draft["agency"] = key
        if then == "modal":
            await interaction.response.send_modal(DetailsModal(self, draft))
            return
        await self.show_preview(interaction, draft)

    async def details_submitted(
        self,
        interaction: discord.Interaction,
        draft: Dict[str, Any],
        *,
        name: str,
        eow: str,
        source: str,
        text: str,
        photo: str,
    ) -> None:
        draft["name"] = name.strip()
        draft["text"] = text.strip()
        # Store the cleaned form when it is usable and the raw one when it is
        # not, so the preview can point at what is actually wrong. Same deal
        # for the date: a readable one is normalised to ISO, an unreadable one
        # comes back in the modal exactly as it was typed.
        draft["eow"] = parse_eow(eow) or eow.strip()
        draft["source"] = clean_url(source) or source.strip()
        draft["photo"] = clean_url(photo) or photo.strip()
        # The download can take longer than the 3 seconds an interaction gets,
        # so acknowledge first and edit the message when the photo is in hand.
        try:
            await interaction.response.defer()
        except discord.HTTPException:
            pass
        await self.mirror_photo(draft)
        await self.show_preview(interaction, draft, refresh_photo=True)

    async def show_preview(
        self,
        interaction: discord.Interaction,
        draft: Dict[str, Any],
        *,
        refresh_photo: bool = False,
    ) -> None:
        """Put the finished embed in front of the member, with the controls.

        ``refresh_photo`` re-uploads (or strips) the mirrored photo on the
        preview message. Steps that cannot have changed it — picking a
        different agency — leave the attachment alone, which is also what
        keeps ``attachment://`` in the embed pointing at something.
        """
        view = PreviewView(self, draft)
        blocked = bool(self.problems(draft))
        view.send.disabled = blocked
        photo = draft.get("_photo")
        embed = memorial_embed(draft, credit=None, photo_ref=photo.reference if photo else None)
        payload = {
            "content": self.preview_note(draft),
            "embed": embed,
            "view": view,
        }
        attachments = None
        if refresh_photo:
            attachments = [photo.as_file()] if photo else []
        try:
            if interaction.response.is_done():
                await interaction.edit_original_response(
                    **payload, **({"attachments": attachments} if attachments is not None else {})
                )
            else:
                await interaction.response.edit_message(
                    **payload, **({"attachments": attachments} if attachments is not None else {})
                )
        except (discord.InteractionResponded, discord.HTTPException):
            # If Discord will not let this interaction edit its message, a
            # fresh private message still gets the member their preview.
            try:
                files = [photo.as_file()] if photo else []
                await interaction.followup.send(ephemeral=True, files=files, **payload)
            except discord.HTTPException:
                log.exception("cufffallen: could not show a preview")

    async def submit_for_approval(
        self, interaction: discord.Interaction, draft: Dict[str, Any]
    ) -> None:
        """Freeze the draft into a stored submission and hand it to the admins."""
        guild = interaction.guild
        if guild is None:
            return
        found = self.problems(draft)
        if found:
            await self.show_preview(interaction, draft)
            return

        conf = await self.config.guild(guild).all()
        test = bool(conf["test_mode"])
        review_channel, _ = await self.target_channels(guild, test=test)
        if review_channel is None:
            # Keep the draft and the preview on screen — this is the bot's
            # problem to fix, and losing what they wrote over it would be rude.
            await interaction.response.edit_message(
                content=(
                    "The review channel is missing or I cannot see it, so this could not be "
                    "sent. Please tell an admin — your text is still here."
                ),
                embed=memorial_embed(draft, credit=None),
                view=PreviewView(self, draft),
            )
            return

        await interaction.response.defer()
        # Two members pressing Submit in the same second must not be handed the
        # same number — read and bump the counter under one lock.
        async with self._lock(guild.id, "next_id"):
            sub_id = str(await self.config.guild(guild).next_id())
            await self.config.guild(guild).next_id.set(int(sub_id) + 1)

        photo = draft.get("_photo")
        submission = {
            "id": sub_id,
            "user_id": interaction.user.id,
            "user_name": str(interaction.user),
            "name": draft["name"],
            "agency": draft["agency"],
            "eow": parse_eow(draft.get("eow")) or "",
            "source": clean_url(draft["source"]),
            "text": draft["text"],
            "photo": clean_url(draft.get("photo")) or "",
            #: The photo's bytes live on the review message as an attachment;
            #: publishing reads them back from there. The URL above is only
            #: the fallback for when that read fails.
            "photo_mirrored": photo is not None,
            "photo_filename": photo.filename if photo else "",
            "test": test,
            "status": "pending",
            "created_at": time.time(),
            "review_channel_id": review_channel.id,
            "review_message_id": None,
            "decided_by": None,
            "decided_at": None,
            "reason": "",
            "edited_by": None,
            "published_channel_id": None,
            "published_message_id": None,
        }

        try:
            message = await review_channel.send(
                embeds=[
                    memorial_embed(
                        submission,
                        credit=None,
                        test=test,
                        photo_ref=photo.reference if photo else None,
                    ),
                    await self.status_embed(guild, submission),
                ],
                files=[photo.as_file()] if photo else [],
                view=ReviewView(self, sub_id, submission["agency"]),
                allowed_mentions=discord.AllowedMentions.none(),
            )
        except discord.HTTPException as error:
            log.warning("cufffallen: review post failed (%s)", error)
            await interaction.followup.send(
                "Discord refused the review post — most likely the photo link. "
                "Try a different picture, or leave it out.",
                ephemeral=True,
            )
            return

        submission["review_message_id"] = message.id
        async with self.config.guild(guild).submissions() as subs:
            subs[sub_id] = submission
        self._registered.add(f"{guild.id}:{sub_id}")

        self.drop_draft(interaction)
        where = " (test mode — nothing reaches the memorial channel)" if test else ""
        try:
            await interaction.edit_original_response(
                content=(
                    f"**Sent to the admins.** Reference `#{sub_id}`{where}.\n"
                    "You will get a DM as soon as it is approved or denied."
                ),
                # The preview message already carries the mirrored photo as
                # its attachment, so the reference keeps resolving here.
                embed=memorial_embed(
                    submission,
                    credit=None,
                    test=test,
                    photo_ref=photo.reference if photo else None,
                ),
                view=None,
            )
        except discord.HTTPException:
            pass

    # ------------------------------------------------------------------
    # Review
    # ------------------------------------------------------------------

    async def status_embed(self, guild: discord.Guild, sub: Dict[str, Any]) -> discord.Embed:
        """The admin-facing half of a review post: who, what, where, and what a ping will do."""
        conf = await self.config.guild(guild).all()
        agency = agency_for(sub.get("agency"))
        status = str(sub.get("status") or "pending")
        colors = {
            "pending": TEST_COLOR if sub.get("test") else PENDING_COLOR,
            "approved": APPROVED_COLOR,
            "denied": DENIED_COLOR,
            "cancelled": DENIED_COLOR,
        }
        embed = discord.Embed(
            color=colors.get(status, PENDING_COLOR),
            title=f"Submission #{sub['id']} — {STATUS_LABELS.get(status, status)}",
        )
        if sub.get("test"):
            embed.description = "🧪 **Test mode.** Approving this posts to the test channel only."

        author = f"<@{sub['user_id']}>" if sub.get("user_id") else "*(deleted)*"
        embed.add_field(name="Submitted by", value=f"{author}\n`{sub.get('user_name') or '?'}`")
        embed.add_field(name="Agency", value=f"{agency.emoji} {agency.label}")

        ping_role = role_id_for(agency.key, conf["role_ids"])
        if sub.get("test") and not conf["test_ping"]:
            ping = "none — test mode (`!fallenhero testping on` to include it)"
        elif ping_role:
            ping = f"<@&{ping_role}>"
        else:
            ping = "none — this agency has no role"
        embed.add_field(name="Ping on approval", value=ping)

        _, publish_channel = await self.target_channels(guild, test=bool(sub.get("test")))
        embed.add_field(
            name="Publishes to",
            value=publish_channel.mention if publish_channel else "⚠️ channel missing",
        )
        embed.add_field(name="Source", value=f"[link]({sub['source']})" if sub.get("source") else "—")
        if sub.get("photo_mirrored"):
            photo_line = f"saved to Discord ([original]({sub['photo']}))" if sub.get("photo") else "saved to Discord"
        elif sub.get("photo"):
            # Hotlinked only — worth a warning where the admin will read it,
            # because a signed CDN link outlives the review, not the memorial.
            photo_line = f"[link]({sub['photo']})" + (
                "\n⚠️ expiring link, could not be saved — the picture will die with it"
                if looks_expiring(sub["photo"])
                else "\n⚠️ hotlinked, not saved"
            )
        else:
            photo_line = "—"
        embed.add_field(name="Photo", value=photo_line)

        if sub.get("edited_by"):
            embed.add_field(name="Edited by", value=f"<@{sub['edited_by']}>", inline=False)
        if sub.get("decided_by"):
            verb = "Approved by" if status == "approved" else "Decided by"
            embed.add_field(name=verb, value=f"<@{sub['decided_by']}>", inline=False)
        if sub.get("reason"):
            embed.add_field(name="Reason", value=clip(sub["reason"], 1024), inline=False)
        if sub.get("published_message_id") and sub.get("published_channel_id"):
            link = (
                f"https://discord.com/channels/{guild.id}/"
                f"{sub['published_channel_id']}/{sub['published_message_id']}"
            )
            embed.add_field(name="Posted", value=f"[jump to the memorial]({link})", inline=False)

        embed.set_footer(text=f"Submission #{sub['id']}")
        if sub.get("created_at"):
            embed.timestamp = datetime.fromtimestamp(float(sub["created_at"]), tz=timezone.utc)
        return embed

    @staticmethod
    def sub_photo_ref(sub: Dict[str, Any]) -> Optional[str]:
        """The ``attachment://`` reference for a mirrored photo, if there is one.

        Only valid on messages that actually carry the attachment — the review
        message and the published post — which is exactly where it is used.
        """
        if sub.get("photo_mirrored") and sub.get("photo_filename"):
            return f"attachment://{sub['photo_filename']}"
        return None

    async def read_review_photo(
        self, guild: discord.Guild, sub: Dict[str, Any]
    ) -> Optional[discord.File]:
        """The mirrored photo's bytes, read back off the review message.

        The review message is the photo's storage: config holds JSON, not
        megabytes, and a Discord attachment lives exactly as long as the
        message it is on. Publishing re-uploads a copy, so the memorial does
        not lose its picture if the review post is ever cleaned up.
        """
        if not sub.get("photo_mirrored"):
            return None
        channel = self._channel(guild, sub.get("review_channel_id"))
        if channel is None or not sub.get("review_message_id"):
            return None
        try:
            message = await channel.fetch_message(int(sub["review_message_id"]))
            for attachment in message.attachments:
                if attachment.filename == sub.get("photo_filename"):
                    data = await attachment.read()
                    return discord.File(io.BytesIO(data), filename=attachment.filename)
        except discord.HTTPException as error:
            log.warning(
                "cufffallen: could not read the mirrored photo for #%s (%s)", sub["id"], error
            )
        return None

    async def get_submission(
        self, guild: discord.Guild, sub_id: str
    ) -> Optional[Dict[str, Any]]:
        subs = await self.config.guild(guild).submissions()
        return subs.get(str(sub_id))

    async def save_submission(self, guild: discord.Guild, sub: Dict[str, Any]) -> None:
        async with self.config.guild(guild).submissions() as subs:
            subs[str(sub["id"])] = sub

    async def handle_review_action(
        self, interaction: discord.Interaction, sub_id: str, action: str
    ) -> None:
        """Approve / Edit / Deny, from a button on a review message."""
        guild = interaction.guild
        if guild is None:
            return
        if not await self.is_admin(interaction.user):
            await interaction.response.send_message(
                "Only the admins decide on these.", ephemeral=True
            )
            return

        sub = await self.get_submission(guild, sub_id)
        if sub is None:
            await interaction.response.send_message(
                "That submission is no longer on file — the record was pruned.", ephemeral=True
            )
            return
        if sub.get("status") != "pending":
            # Two admins reached for it at once, or the message is stale.
            await interaction.response.edit_message(
                embeds=[
                    memorial_embed(
                        sub,
                        credit=None,
                        test=bool(sub.get("test")),
                        photo_ref=self.sub_photo_ref(sub),
                    ),
                    await self.status_embed(guild, sub),
                ],
                view=None,
            )
            await interaction.followup.send(
                f"Already {sub.get('status')} — nothing to do.", ephemeral=True
            )
            return

        if action == "edit":
            await interaction.response.send_modal(AdminEditModal(self, sub_id, sub))
            return
        if action == "deny":
            await interaction.response.send_modal(DenyModal(self, sub_id))
            return
        if action == "approve":
            await self.approve(interaction, sub_id)

    async def approve(self, interaction: discord.Interaction, sub_id: str) -> None:
        guild = interaction.guild
        assert guild is not None
        await interaction.response.defer()
        async with self._lock(guild.id, sub_id):
            sub = await self.get_submission(guild, sub_id)
            if sub is None or sub.get("status") != "pending":
                await interaction.followup.send("Already decided.", ephemeral=True)
                return

            conf = await self.config.guild(guild).all()
            test = bool(sub.get("test"))
            _, channel = await self.target_channels(guild, test=test)
            if channel is None:
                await interaction.followup.send(
                    "The channel this should publish to is missing or invisible to me. "
                    "Fix it with `!fallenhero channel`, then approve again.",
                    ephemeral=True,
                )
                return

            role_id = role_id_for(agency_for(sub.get("agency")).key, conf["role_ids"])
            if test and not conf["test_ping"]:
                role_id = None  # a rehearsal that pings a role is not a rehearsal

            credit = None
            if conf["credit_submitter"] and sub.get("user_id"):
                member = guild.get_member(int(sub["user_id"]))
                credit = member.display_name if member else sub.get("user_name")

            # The mirrored photo travels as a fresh upload; the stored URL is
            # only the fallback if reading it back fails, and for a signed CDN
            # link that fallback is a countdown, so the admin is told.
            photo_file = await self.read_review_photo(guild, sub)
            if sub.get("photo_mirrored") and photo_file is None:
                await interaction.followup.send(
                    "⚠️ The saved photo could not be read back off the review message, "
                    "so the memorial hotlinks the original URL instead — if that link "
                    "expires, the picture goes blank.",
                    ephemeral=True,
                )

            try:
                posted = await channel.send(
                    content=f"<@&{role_id}>" if role_id else None,
                    embed=memorial_embed(
                        sub,
                        credit=credit,
                        test=test,
                        photo_ref=self.sub_photo_ref(sub) if photo_file else None,
                    ),
                    files=[photo_file] if photo_file else [],
                    allowed_mentions=(
                        discord.AllowedMentions(roles=[discord.Object(id=role_id)])
                        if role_id
                        else discord.AllowedMentions.none()
                    ),
                )
            except discord.HTTPException as error:
                log.warning("cufffallen: publishing #%s failed (%s)", sub_id, error)
                await interaction.followup.send(
                    f"Discord refused the post: `{error}`. The submission is still pending.",
                    ephemeral=True,
                )
                return

            sub["status"] = "approved"
            sub["decided_by"] = interaction.user.id
            sub["decided_at"] = time.time()
            sub["published_channel_id"] = channel.id
            sub["published_message_id"] = posted.id
            await self.save_submission(guild, sub)
            await self.prune(guild)

        await self.finish_review(interaction, guild, sub)
        await self.tell_submitter(
            guild,
            sub,
            title="✅ Your fallen hero submission was approved",
            body=(
                f"Thank you for writing it. It is up now: {posted.jump_url}"
                + ("\n(Test mode — this was posted in the test channel.)" if test else "")
            ),
            color=APPROVED_COLOR,
        )

    async def deny_submitted(
        self, interaction: discord.Interaction, sub_id: str, *, reason: str
    ) -> None:
        guild = interaction.guild
        if guild is None:
            return
        async with self._lock(guild.id, sub_id):
            sub = await self.get_submission(guild, sub_id)
            if sub is None or sub.get("status") != "pending":
                await interaction.response.send_message("Already decided.", ephemeral=True)
                return
            sub["status"] = "denied"
            sub["decided_by"] = interaction.user.id
            sub["decided_at"] = time.time()
            sub["reason"] = reason.strip()
            await self.save_submission(guild, sub)
            await self.prune(guild)

        await interaction.response.defer()
        await self.finish_review(interaction, guild, sub)
        await self.tell_submitter(
            guild,
            sub,
            title="🚫 Your fallen hero submission was not published",
            body=(
                (reason.strip() or "No reason was given.")
                + "\n\nYou are welcome to submit it again from the panel with that fixed."
            ),
            color=DENIED_COLOR,
        )

    async def review_agency_set(
        self, interaction: discord.Interaction, sub_id: str, key: str
    ) -> None:
        """The dropdown on the review message: the agency, changed in place."""
        guild = interaction.guild
        if guild is None:
            return
        if not await self.is_admin(interaction.user):
            await interaction.response.send_message(
                "Only the admins decide on these.", ephemeral=True
            )
            return
        sub = await self.get_submission(guild, sub_id)
        if sub is None or sub.get("status") != "pending":
            await interaction.response.send_message(
                "That submission is no longer pending.", ephemeral=True
            )
            return
        if key not in AGENCIES:
            return
        sub["agency"] = key
        sub["edited_by"] = interaction.user.id
        await self.save_submission(guild, sub)
        # Redrawn whole so the status embed's "ping on approval" line follows
        # the new agency immediately — that line is why the picker exists.
        await interaction.response.edit_message(
            embeds=[
                memorial_embed(
                    sub,
                    credit=None,
                    test=bool(sub.get("test")),
                    photo_ref=self.sub_photo_ref(sub),
                ),
                await self.status_embed(guild, sub),
            ],
            view=ReviewView(self, sub_id, key),
        )

    async def admin_edit_submitted(
        self,
        interaction: discord.Interaction,
        sub_id: str,
        *,
        name: str,
        eow: str,
        source: str,
        text: str,
        photo: str,
    ) -> None:
        """An admin's correction. Refused whole rather than saved half-right."""
        guild = interaction.guild
        if guild is None:
            return
        sub = await self.get_submission(guild, sub_id)
        if sub is None or sub.get("status") != "pending":
            await interaction.response.send_message(
                "That submission is no longer pending.", ephemeral=True
            )
            return

        clean_source = clean_url(source)
        raw_photo = photo.strip()
        clean_photo = clean_url(raw_photo) if raw_photo else None

        complaints = []
        date_complaint = eow_problem(eow)
        if date_complaint:
            complaints.append(date_complaint)
        if not clean_source:
            complaints.append("The source link is not a working `http(s)://` link.")
        if raw_photo and not clean_photo:
            complaints.append("The photo link is not a working `http(s)://` link.")
        if not name.strip() or not text.strip():
            complaints.append("Name and message cannot be empty.")
        if complaints:
            await interaction.response.send_message(
                "**Not saved:**\n" + "\n".join(f"• {line}" for line in complaints),
                ephemeral=True,
            )
            return

        # A changed photo link means a changed mirror; a kept one means the
        # attachment on the review message stays exactly as it is.
        photo_changed = (clean_photo or "") != (sub.get("photo") or "")
        attachments = None
        try:
            await interaction.response.defer()
        except discord.HTTPException:
            pass
        if photo_changed:
            if clean_photo:
                mirrored, why = await fetch_photo(await self.session(), clean_photo)
                if mirrored:
                    attachments = [mirrored.as_file()]
                    sub["photo_mirrored"] = True
                    sub["photo_filename"] = mirrored.filename
                else:
                    attachments = []
                    sub["photo_mirrored"] = False
                    sub["photo_filename"] = ""
                    await interaction.followup.send(
                        f"The new photo could not be saved ({why}) — it will be "
                        "hotlinked, and dies with the link.",
                        ephemeral=True,
                    )
            else:
                attachments = []
                sub["photo_mirrored"] = False
                sub["photo_filename"] = ""

        sub.update(
            {
                "name": name.strip(),
                "eow": parse_eow(eow) or "",
                "source": clean_source,
                "text": text.strip(),
                "photo": clean_photo or "",
                "edited_by": interaction.user.id,
            }
        )
        await self.save_submission(guild, sub)
        try:
            await interaction.edit_original_response(
                embeds=[
                    memorial_embed(
                        sub,
                        credit=None,
                        test=bool(sub.get("test")),
                        photo_ref=self.sub_photo_ref(sub),
                    ),
                    await self.status_embed(guild, sub),
                ],
                view=ReviewView(self, sub_id, sub.get("agency")),
                **({"attachments": attachments} if attachments is not None else {}),
            )
        except discord.HTTPException:
            log.warning("cufffallen: could not refresh the review post for #%s", sub_id)

    async def finish_review(
        self, interaction: discord.Interaction, guild: discord.Guild, sub: Dict[str, Any]
    ) -> None:
        """Close out the review message: final state, buttons gone."""
        embeds = [
            memorial_embed(
                sub, credit=None, test=bool(sub.get("test")), photo_ref=self.sub_photo_ref(sub)
            ),
            await self.status_embed(guild, sub),
        ]
        try:
            await interaction.edit_original_response(embeds=embeds, view=None)
        except discord.HTTPException:
            # The interaction is spent (a modal that took too long, a deleted
            # message) — edit the stored message directly instead.
            channel = self._channel(guild, sub.get("review_channel_id"))
            if channel and sub.get("review_message_id"):
                try:
                    message = await channel.fetch_message(int(sub["review_message_id"]))
                    await message.edit(embeds=embeds, view=None)
                except discord.HTTPException:
                    log.warning("cufffallen: could not close review message for #%s", sub["id"])
        self._registered.discard(f"{guild.id}:{sub['id']}")

    async def tell_submitter(
        self, guild: discord.Guild, sub: Dict[str, Any], *, title: str, body: str, color: int
    ) -> None:
        """DM the decision. A closed DM is not an error worth surfacing."""
        if not sub.get("user_id"):
            return
        member = guild.get_member(int(sub["user_id"]))
        if member is None:
            return
        embed = discord.Embed(color=color, title=title, description=clip(body, 4096))
        embed.add_field(name="Fallen hero", value=clip(sub.get("name"), 1024) or "—")
        embed.set_footer(text=f"{guild.name} · submission #{sub['id']}")
        try:
            await member.send(embed=embed)
        except discord.HTTPException:
            log.info("cufffallen: could not DM %s about #%s", member.id, sub["id"])

    async def prune(self, guild: discord.Guild) -> None:
        """Keep every pending submission and the last KEEP_DECIDED decided ones."""
        async with self.config.guild(guild).submissions() as subs:
            decided = [
                (float(sub.get("decided_at") or sub.get("created_at") or 0), key)
                for key, sub in subs.items()
                if sub.get("status") != "pending"
            ]
            if len(decided) <= KEEP_DECIDED:
                return
            decided.sort()
            for _, key in decided[: len(decided) - KEEP_DECIDED]:
                subs.pop(key, None)

    # ------------------------------------------------------------------
    # Commands
    # ------------------------------------------------------------------

    @commands.guild_only()
    @commands.group(name="fallenhero", aliases=["fallen"], invoke_without_command=True)
    async def fallenhero(self, ctx: commands.Context):
        """Member-submitted memorials, published after admin approval."""
        await ctx.send_help()

    @fallenhero.command(name="panel")
    @checks.admin_or_permissions(manage_guild=True)
    async def panel_cmd(self, ctx: commands.Context, channel: discord.TextChannel = None):
        """Post (or move) the submission panel. Defaults to the information channel."""
        conf = self.config.guild(ctx.guild)
        target = channel or self._channel(ctx.guild, await conf.panel_channel_id())
        if target is None:
            await ctx.send("I cannot see that channel. Name one I can post in.")
            return

        embed = discord.Embed(
            color=MEMORIAL_COLOR,
            title="🕯️ Submit a Fallen Hero",
            description=(
                "Know a fallen first responder our memorial feeds missed? Write their "
                "memorial here and an admin will review it before it is posted in "
                f"<#{await conf.publish_channel_id()}>.\n\n"
                "**You will be asked for**\n"
                "• Their name\n"
                "• Their agency — Police, Fire, Correctional or Ambulance\n"
                "• Their end of watch — the date they died (optional)\n"
                "• A link to the source\n"
                "• The message itself (Discord markdown works)\n"
                "• Optionally a link to a photo — a **direct image link** (right-click "
                "the picture → *Copy image address*). The photo is saved with the "
                "post, so the link only has to work once\n\n"
                "You get a full preview and can edit it as often as you like before it "
                "goes to the admins, and a DM when they decide."
            ),
        )
        embed.set_footer(text="Gone, but not forgotten.")

        old_id = await conf.panel_message_id()
        if old_id:
            old_channel = self._channel(ctx.guild, await conf.panel_channel_id())
            if old_channel:
                try:
                    old = await old_channel.fetch_message(int(old_id))
                    await old.delete()
                except discord.HTTPException:
                    pass
        try:
            message = await target.send(embed=embed, view=PanelView(self))
        except discord.HTTPException as error:
            await ctx.send(f"Could not post there: `{error}`")
            return
        await conf.panel_channel_id.set(target.id)
        await conf.panel_message_id.set(message.id)
        await ctx.send(f"Panel posted in {target.mention}.")

    @fallenhero.command(name="test")
    @checks.admin_or_permissions(manage_guild=True)
    async def test_cmd(self, ctx: commands.Context, state: bool = None):
        """Test mode: everything goes to the test channel instead.

        Admins only, by design. While it is on, a submission is stamped as a
        test when it is sent — turning the switch back off does not promote a
        queued test into the real memorial channel.
        """
        conf = self.config.guild(ctx.guild)
        if state is None:
            state = not await conf.test_mode()
        await conf.test_mode.set(bool(state))
        test_channel = self._channel(ctx.guild, await conf.test_channel_id())
        where = test_channel.mention if test_channel else "the test channel (missing!)"
        if state:
            await ctx.send(
                f"🧪 **Test mode on.** New submissions and their memorial posts go to {where}. "
                f"Pings are {'included' if await conf.test_ping() else 'suppressed'} "
                "(`!fallenhero testping`)."
            )
        else:
            await ctx.send("Test mode off. Submissions run for real again.")

    @fallenhero.command(name="testping")
    @checks.admin_or_permissions(manage_guild=True)
    async def testping_cmd(self, ctx: commands.Context, state: bool):
        """Whether a test post tags the agency role for real."""
        await self.config.guild(ctx.guild).test_ping.set(state)
        await ctx.send(
            "Test posts will tag the agency role for real."
            if state
            else "Test posts stay silent — no role is tagged."
        )

    @fallenhero.command(name="channel")
    @checks.admin_or_permissions(manage_guild=True)
    async def channel_cmd(self, ctx: commands.Context, which: str, channel: discord.TextChannel):
        """Move one of the four channels: `panel`, `review`, `publish` or `test`."""
        keys = {
            "panel": "panel_channel_id",
            "review": "review_channel_id",
            "publish": "publish_channel_id",
            "memorial": "publish_channel_id",
            "test": "test_channel_id",
        }
        key = keys.get(which.lower())
        if key is None:
            await ctx.send("Pick one of: `panel`, `review`, `publish`, `test`.")
            return
        await self.config.guild(ctx.guild).set_raw(key, value=channel.id)
        await ctx.send(f"`{which.lower()}` now points at {channel.mention}.")

    @fallenhero.command(name="role")
    @checks.admin_or_permissions(manage_guild=True)
    async def role_cmd(self, ctx: commands.Context, agency: str, role: discord.Role = None):
        """Set (or clear) the role tagged when an agency's submission is approved.

        Leave the role out to stop tagging for that agency — that is how
        ambulance is set up out of the box.
        """
        key = parse_agency(agency)
        if key is None:
            await ctx.send("Agency must be one of: fire, police, correctional, ambulance.")
            return
        async with self.config.guild(ctx.guild).role_ids() as roles:
            roles[key] = role.id if role else 0
        await ctx.send(
            f"{AGENCIES[key].label} submissions will tag {role.mention}."
            if role
            else f"{AGENCIES[key].label} submissions will be posted without a ping.",
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @fallenhero.command(name="credit")
    @checks.admin_or_permissions(manage_guild=True)
    async def credit_cmd(self, ctx: commands.Context, state: bool):
        """Whether the published footer names the member who submitted it."""
        await self.config.guild(ctx.guild).credit_submitter.set(state)
        await ctx.send(
            "Published memorials will credit the submitter."
            if state
            else "Published memorials will not name the submitter."
        )

    @fallenhero.command(name="maxpending")
    @checks.admin_or_permissions(manage_guild=True)
    async def maxpending_cmd(self, ctx: commands.Context, count: int):
        """How many submissions one member may have in the queue at once."""
        count = max(1, min(25, count))
        await self.config.guild(ctx.guild).max_pending.set(count)
        await ctx.send(f"A member may now have {count} submission(s) awaiting review.")

    @fallenhero.command(name="enable")
    @checks.admin_or_permissions(manage_guild=True)
    async def enable_cmd(self, ctx: commands.Context, state: bool):
        """Open or close submissions. The panel stays up either way."""
        await self.config.guild(ctx.guild).enabled.set(state)
        await ctx.send("Submissions are open." if state else "Submissions are closed.")

    @fallenhero.command(name="pending")
    @checks.admin_or_permissions(manage_guild=True)
    async def pending_cmd(self, ctx: commands.Context):
        """Everything currently waiting on a decision."""
        subs = await self.config.guild(ctx.guild).submissions()
        waiting = sorted(
            (s for s in subs.values() if s.get("status") == "pending"),
            key=lambda s: float(s.get("created_at") or 0),
        )
        if not waiting:
            await ctx.send("Nothing is waiting for review.")
            return
        embed = discord.Embed(color=PENDING_COLOR, title=f"{len(waiting)} awaiting review")
        for sub in waiting[:20]:
            link = ""
            if sub.get("review_message_id") and sub.get("review_channel_id"):
                link = (
                    f"\n[review post](https://discord.com/channels/{ctx.guild.id}/"
                    f"{sub['review_channel_id']}/{sub['review_message_id']})"
                )
            when = f"<t:{int(float(sub.get('created_at') or 0))}:R>"
            embed.add_field(
                name=f"#{sub['id']} — {clip(sub.get('name'), 60)}",
                value=(
                    f"{agency_for(sub.get('agency')).label}"
                    f"{' · 🧪 test' if sub.get('test') else ''} · <@{sub.get('user_id')}> {when}"
                    f"{link}"
                ),
                inline=False,
            )
        await ctx.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())

    @fallenhero.command(name="show")
    @checks.admin_or_permissions(manage_guild=True)
    async def show_cmd(self, ctx: commands.Context, sub_id: str):
        """Look at one submission, decided or not."""
        sub = await self.get_submission(ctx.guild, sub_id.lstrip("#"))
        if sub is None:
            await ctx.send("No submission on file with that number.")
            return
        # This lands in whatever channel the command ran in, where the review
        # message's attachment:// cannot resolve — so the photo rides along.
        photo_file = await self.read_review_photo(ctx.guild, sub)
        await ctx.send(
            embeds=[
                memorial_embed(
                    sub,
                    credit=None,
                    test=bool(sub.get("test")),
                    photo_ref=self.sub_photo_ref(sub) if photo_file else None,
                ),
                await self.status_embed(ctx.guild, sub),
            ],
            files=[photo_file] if photo_file else [],
            allowed_mentions=discord.AllowedMentions.none(),
        )

    @fallenhero.command(name="cancel")
    @checks.admin_or_permissions(manage_guild=True)
    async def cancel_cmd(self, ctx: commands.Context, sub_id: str, *, reason: str = ""):
        """Take a pending submission out of the queue without denying it."""
        sub_id = sub_id.lstrip("#")
        sub = await self.get_submission(ctx.guild, sub_id)
        if sub is None or sub.get("status") != "pending":
            await ctx.send("That submission is not pending.")
            return
        sub["status"] = "cancelled"
        sub["decided_by"] = ctx.author.id
        sub["decided_at"] = time.time()
        sub["reason"] = reason
        await self.save_submission(ctx.guild, sub)
        channel = self._channel(ctx.guild, sub.get("review_channel_id"))
        if channel and sub.get("review_message_id"):
            try:
                message = await channel.fetch_message(int(sub["review_message_id"]))
                await message.edit(
                    embeds=[
                        memorial_embed(
                            sub,
                            credit=None,
                            test=bool(sub.get("test")),
                            photo_ref=self.sub_photo_ref(sub),
                        ),
                        await self.status_embed(ctx.guild, sub),
                    ],
                    view=None,
                )
            except discord.HTTPException:
                pass
        self._registered.discard(f"{ctx.guild.id}:{sub_id}")
        await ctx.send(f"#{sub_id} cancelled.")

    @fallenhero.command(name="settings")
    @checks.admin_or_permissions(manage_guild=True)
    async def settings_cmd(self, ctx: commands.Context):
        """Every setting, and what a submission would do right now."""
        conf = await self.config.guild(ctx.guild).all()
        subs = conf["submissions"] or {}
        pending = sum(1 for s in subs.values() if s.get("status") == "pending")

        def chan(key: str) -> str:
            found = self._channel(ctx.guild, conf[key])
            return found.mention if found else f"⚠️ missing (`{conf[key]}`)"

        embed = discord.Embed(
            color=TEST_COLOR if conf["test_mode"] else MEMORIAL_COLOR,
            title="Fallen hero submissions",
            description=(
                "🧪 **TEST MODE IS ON** — new submissions and their posts go to the "
                "test channel."
                if conf["test_mode"]
                else "Running live."
            ),
        )
        embed.add_field(name="Submissions", value="open" if conf["enabled"] else "closed")
        embed.add_field(name="Panel", value=chan("panel_channel_id"))
        embed.add_field(name="Review", value=chan("review_channel_id"))
        embed.add_field(name="Publish", value=chan("publish_channel_id"))
        embed.add_field(name="Test", value=chan("test_channel_id"))
        embed.add_field(name="Test pings", value="on" if conf["test_ping"] else "suppressed")
        embed.add_field(name="Credit submitter", value="on" if conf["credit_submitter"] else "off")
        embed.add_field(name="Max pending / member", value=str(conf["max_pending"]))
        embed.add_field(name="Awaiting review", value=str(pending))

        lines = []
        for key in AGENCY_ORDER:
            role_id = role_id_for(key, conf["role_ids"])
            role = ctx.guild.get_role(role_id) if role_id else None
            if role_id and role is None:
                shown = f"⚠️ `{role_id}` (gone)"
            elif role:
                shown = role.mention
            else:
                shown = "no ping"
            lines.append(f"{AGENCIES[key].emoji} **{AGENCIES[key].label}** — {shown}")
        embed.add_field(name="Ping roles", value="\n".join(lines), inline=False)
        await ctx.send(embed=embed, allowed_mentions=discord.AllowedMentions.none())
