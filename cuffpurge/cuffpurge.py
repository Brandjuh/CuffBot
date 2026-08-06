"""CuffPurge — empty a channel, deliberately and with the brakes on.

Red's own Cleanup cog deletes messages *by criterion* — a count, an author, a
span between two messages. What it has no command for is the blunt one: empty
this channel, all of it, however old.

That command is easy to write and easy to regret, so the shape here is built
around the regret rather than the deletion:

* nothing happens without a **confirmation** that names the channel and states
  the message count out loud,
* a run can be **stopped** halfway from a button, and reports how far it got,
* **pinned messages survive by default**, because a pin is somebody having
  already said this one matters — ``[p]purge all #channel yes`` includes them,
* the whole thing lands in the **audit log** attributed to whoever ran it.

The 14-day line is the reason this is slower than it looks. Discord's bulk
delete refuses anything older, so past that line every message costs its own
API call and its own slice of the rate limit: a channel with thousands of old
messages is a long job, not a slow second. Progress is reported live so that
is visible while it happens rather than afterwards.
"""

from __future__ import annotations

import contextlib
import logging
import time
from datetime import timedelta
from typing import List, Optional, Set, Tuple, Union

import discord
from redbot.core import checks, commands
from redbot.core.bot import Red

log = logging.getLogger("red.cuff-cogs.cuffpurge")

#: Discord refuses to bulk-delete anything older than this. Past the line each
#: message costs one API call, which is the difference between a few seconds
#: and a very long afternoon.
BULK_CUTOFF = timedelta(days=14)

#: Discord's ceiling for a single bulk delete.
CHUNK = 100

#: How often the progress line is rewritten. Editing on every chunk would
#: spend the channel's message budget on progress reports instead of on the
#: deleting we are actually here for.
PROGRESS_EVERY_SECS = 5.0

CONFIRM_TIMEOUT_SECS = 60.0

EMBED_COLOR = 0xC0392B

#: Everything with a message history that a purge makes sense in.
GuildMessageable = Union[
    discord.TextChannel,
    discord.Thread,
    discord.VoiceChannel,
    discord.StageChannel,
]


def describe_count(deleted: int, kept: int) -> str:
    """The one-line result, in words that say what actually happened."""
    parts = [f"**{deleted}** message{'' if deleted == 1 else 's'} deleted"]
    if kept:
        parts.append(f"{kept} pinned message{'' if kept == 1 else 's'} kept")
    return " · ".join(parts)


class _Confirm(discord.ui.View):
    """The are-you-sure. Locked to whoever asked, and cancelled by default.

    A timeout leaves ``result`` as ``None`` — walking away from the prompt has
    to mean "no", never "yes after a while".
    """

    def __init__(self, author_id: int):
        super().__init__(timeout=CONFIRM_TIMEOUT_SECS)
        self.author_id = author_id
        self.result: Optional[bool] = None

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                "That prompt belongs to somebody else.", ephemeral=True
            )
            return False
        return True

    @discord.ui.button(label="Delete everything", style=discord.ButtonStyle.danger, emoji="🗑️")
    async def _yes(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        self.result = True
        await interaction.response.defer()
        self.stop()

    @discord.ui.button(label="Cancel", style=discord.ButtonStyle.secondary)
    async def _no(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        self.result = False
        await interaction.response.defer()
        self.stop()


class _Running(discord.ui.View):
    """A stop button for a job that may run for a long time.

    No timeout: the run itself decides when this view is done, and a purge
    that outlives its own stop button would be exactly the wrong thing to
    ship.
    """

    def __init__(self, author_id: int):
        super().__init__(timeout=None)
        self.author_id = author_id
        self.stopped = False

    async def interaction_check(self, interaction: discord.Interaction) -> bool:
        if interaction.user.id != self.author_id:
            await interaction.response.send_message(
                "Only whoever started this can stop it.", ephemeral=True
            )
            return False
        return True

    @discord.ui.button(label="Stop", style=discord.ButtonStyle.secondary, emoji="✋")
    async def _stop(self, interaction: discord.Interaction, button: discord.ui.Button) -> None:
        self.stopped = True
        button.disabled = True
        await interaction.response.edit_message(view=self)


class CuffPurge(commands.Cog):
    """Empty a channel completely — with a confirmation, and reversible by nobody."""

    def __init__(self, bot: Red):
        self.bot = bot
        #: Channels with a purge in flight. Two runs on one channel would
        #: fight over the same history and double-count everything.
        self._running: Set[int] = set()

    async def cog_unload(self) -> None:
        self._running.clear()

    # ── Command ─────────────────────────────────────────────────────────────

    @commands.guild_only()
    @commands.group(name="purge", invoke_without_command=True)
    @checks.admin_or_permissions(manage_guild=True)
    async def purge(self, ctx: commands.Context) -> None:
        """Empty a channel of every message."""
        await ctx.send(
            "🗑️ **Purge**\n"
            f"`{ctx.clean_prefix}purge all` empties **this** channel.\n"
            f"`{ctx.clean_prefix}purge all #channel` empties that one instead.\n"
            f"`{ctx.clean_prefix}purge all #channel yes` also deletes the pinned messages "
            "(they are kept otherwise).\n"
            "-# You are asked to confirm first, and the run can be stopped halfway. "
            "Messages older than 14 days are deleted one at a time, which is slow.\n"
            f"-# For anything narrower — a count, one author, a span — use `{ctx.clean_prefix}cleanup`."
        )

    @purge.command(name="all", aliases=["everything", "channel"])
    @checks.admin_or_permissions(manage_guild=True)
    async def purge_all(
        self,
        ctx: commands.Context,
        channel: Optional[GuildMessageable] = None,
        include_pins: bool = False,
    ) -> None:
        """Delete every message in a channel. This cannot be undone.

        Defaults to the channel you run it in. Pass `yes` as the last argument
        to delete the pinned messages too.
        """
        target = channel or ctx.channel
        if getattr(target, "guild", None) != ctx.guild:
            await ctx.send("🗑️ That channel is not in this server.")
            return

        # Permission is checked on the TARGET, not on where the command was
        # typed: otherwise a moderator could empty a channel they have no
        # business in by running this from one they do.
        author_perms = target.permissions_for(ctx.author)
        if not (author_perms.manage_messages or ctx.author.guild_permissions.administrator):
            await ctx.send(f"🗑️ You cannot manage messages in {target.mention}.")
            return

        perms = target.permissions_for(ctx.guild.me)
        missing = [
            name
            for name, held in (
                ("Manage Messages", perms.manage_messages),
                ("Read Message History", perms.read_message_history),
                ("View Channel", perms.view_channel),
            )
            if not held
        ]
        if missing:
            await ctx.send(f"🗑️ I am missing **{'**, **'.join(missing)}** in {target.mention}.")
            return

        if target.id in self._running:
            await ctx.send(f"🗑️ {target.mention} is already being emptied.")
            return

        pins: List[discord.Message] = []
        try:
            pins = list(await target.pins())
        except discord.HTTPException:
            # Not fatal — it only means the confirmation cannot say how many
            # pins are at stake, so it says that instead of guessing.
            pins = []

        confirm = _Confirm(ctx.author.id)
        prompt = await ctx.send(embed=self._confirm_embed(ctx, target, pins, include_pins), view=confirm)
        await confirm.wait()

        if confirm.result is not True:
            reason = "Cancelled." if confirm.result is False else "Timed out — nothing was deleted."
            await prompt.edit(content=f"🗑️ {reason}", embed=None, view=None)
            return

        running = _Running(ctx.author.id)
        await prompt.edit(
            content=f"🗑️ Emptying {target.mention}… **0** deleted so far.",
            embed=None,
            view=running,
        )

        self._running.add(target.id)
        try:
            deleted, kept, error = await self._empty(
                target,
                status=prompt,
                view=running,
                include_pins=include_pins,
                reason=f"purge by {ctx.author} ({ctx.author.id})",
            )
        finally:
            self._running.discard(target.id)

        await self._report(prompt, target, deleted, kept, error, stopped=running.stopped)

    # ── The work ────────────────────────────────────────────────────────────

    def _confirm_embed(
        self,
        ctx: commands.Context,
        target: GuildMessageable,
        pins: List[discord.Message],
        include_pins: bool,
    ) -> discord.Embed:
        embed = discord.Embed(
            color=EMBED_COLOR,
            title="🗑️ Empty this channel?",
            description=(
                f"Every message in {target.mention} will be deleted.\n"
                "**This cannot be undone.**"
            ),
        )
        if include_pins:
            pinned = f"**also deleted** ({len(pins)})" if pins else "also deleted"
        else:
            pinned = f"kept ({len(pins)})" if pins else "kept"
        embed.add_field(name="Pinned messages", value=pinned, inline=True)
        embed.add_field(name="Asked by", value=ctx.author.mention, inline=True)
        embed.set_footer(
            text="Messages older than 14 days go one at a time, so this can take a while. "
            "You can stop it halfway."
        )
        return embed

    async def _empty(
        self,
        channel: GuildMessageable,
        *,
        status: discord.Message,
        view: _Running,
        include_pins: bool,
        reason: str,
    ) -> Tuple[int, int, Optional[str]]:
        """Walk the history newest-first and delete it. Returns
        ``(deleted, kept, error)``.

        Newest first on purpose: those are the ones bulk delete still accepts,
        so the fast half happens while somebody is watching, and the slow tail
        is what remains.
        """
        deleted = 0
        kept = 0
        error: Optional[str] = None
        batch: List[discord.Message] = []
        last_edit = time.monotonic()

        async def flush() -> None:
            """Delete one batch, splitting it on the 14-day line."""
            nonlocal deleted
            if not batch:
                return
            cutoff = discord.utils.utcnow() - BULK_CUTOFF
            recent = [m for m in batch if m.created_at > cutoff]
            old = [m for m in batch if m.created_at <= cutoff]
            batch.clear()
            if recent:
                # delete_messages handles 0 and 1 itself, so no special-casing.
                await channel.delete_messages(recent, reason=reason)
                deleted += len(recent)
            for message in old:
                if view.stopped:
                    return
                await message.delete()
                deleted += 1

        try:
            async for message in channel.history(limit=None, oldest_first=False):
                if view.stopped:
                    break
                if message.id == status.id:
                    continue  # the progress line reports the run; it outlives it
                if message.pinned and not include_pins:
                    kept += 1
                    continue
                batch.append(message)
                if len(batch) >= CHUNK:
                    await flush()
                    now = time.monotonic()
                    if now - last_edit >= PROGRESS_EVERY_SECS:
                        last_edit = now
                        await self._progress(status, channel, deleted, view)
            if not view.stopped:
                await flush()
        except discord.Forbidden:
            error = "I lost permission to delete messages there partway through."
        except discord.HTTPException as exc:
            error = f"Discord refused a deletion: {exc}"
            log.warning("Purge: HTTP error while emptying %s: %s", channel.id, exc)
        except Exception as exc:  # a purge must always report what it managed
            error = f"Something went wrong: {exc}"
            log.exception("Purge: unexpected failure while emptying %s", channel.id)

        return deleted, kept, error

    async def _progress(
        self, status: discord.Message, channel: GuildMessageable, deleted: int, view: _Running
    ) -> None:
        """Best-effort progress. A failed edit must never abort the purge."""
        try:
            await status.edit(
                content=f"🗑️ Emptying {channel.mention}… **{deleted}** deleted so far.",
                view=view,
            )
        except discord.HTTPException:
            pass

    async def _report(
        self,
        status: discord.Message,
        channel: GuildMessageable,
        deleted: int,
        kept: int,
        error: Optional[str],
        *,
        stopped: bool,
    ) -> None:
        """The last word: what was deleted, and why it ended when it did."""
        summary = describe_count(deleted, kept)
        if error:
            content = f"🗑️ Stopped early in {channel.mention} — {error}\n{summary}."
        elif stopped:
            content = f"🗑️ Stopped in {channel.mention} on request.\n{summary}."
        else:
            content = f"🗑️ {channel.mention} is empty.\n{summary}."
        try:
            await status.edit(content=content, embed=None, view=None)
        except discord.HTTPException:
            # The status message itself may be gone — it lived in the channel
            # being emptied, and somebody else may have cleaned up. Say it
            # somewhere rather than finishing in silence.
            with contextlib.suppress(discord.HTTPException):
                await channel.send(content)
