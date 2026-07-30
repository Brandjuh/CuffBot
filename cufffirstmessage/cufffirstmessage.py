"""CuffFirstMessage — jump to the very first message in a channel.

A copy of the Fox_V3 ``firstmessage`` cog with one job done properly: the link
is actually **clickable**, in every client and in every permission situation.

The original put a markdown link in an embed description. That link is dead
weight the moment the bot lacks *Embed Links* in the channel (Discord drops the
whole embed, so nothing arrives at all) and it is easy to miss on mobile. Here
the jump is offered three ways at once:

* a real **link button** under the message (a component, not markdown — it
  survives even when embeds are suppressed and is a proper tap target),
* the embed **title** itself links to the message,
* the **raw URL** is in the embed, so it can be copied or long-pressed.

When *Embed Links* is missing the cog falls back to a plain-text reply with the
bare URL (Discord auto-links those) plus the same button, instead of silently
posting nothing.
"""

import logging
from typing import Optional, Union

import discord
from redbot.core import Config, commands
from redbot.core.bot import Red

log = logging.getLogger("red.cuff-cogs.cufffirstmessage")

EMBED_COLOR = 0x5865F2

#: Channel types that actually have a message history to walk back through.
GuildMessageable = Union[
    discord.TextChannel,
    discord.Thread,
    discord.VoiceChannel,
    discord.StageChannel,
]


def _jump_view(url: str, label: str = "Jump to first message") -> discord.ui.View:
    """A view holding a single link button — the clickable bit of the answer.

    Link buttons need no interaction handling and never time out, so the button
    keeps working long after the bot restarts.
    """
    view = discord.ui.View()
    view.add_item(discord.ui.Button(style=discord.ButtonStyle.link, label=label, url=url, emoji="⏫"))
    return view


def _preview(message: discord.Message, limit: int = 300) -> str:
    """A short, safe preview of what that first message actually said."""
    content = (message.content or "").strip()
    if not content:
        if message.attachments:
            return f"*[{len(message.attachments)} attachment(s)]*"
        if message.embeds:
            return "*[embed]*"
        if message.stickers:
            return "*[sticker]*"
        return "*[no text content]*"
    # Escape so a first message full of markdown cannot wreck our embed.
    content = discord.utils.escape_markdown(content)
    if len(content) > limit:
        content = content[: limit - 1].rstrip() + "…"
    return content


class CuffFirstMessage(commands.Cog):
    """Provides a clickable link to the first message in a channel."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot: Red):
        super().__init__()
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175012, force_registration=True)
        self.config.register_guild(use_embed=True)

    async def red_delete_data_for_user(self, **kwargs):
        """Nothing to delete — this cog stores no end user data."""
        return

    @commands.guild_only()
    @commands.command(name="firstmessage", aliases=["firstmsg", "first"])
    @commands.bot_has_permissions(read_message_history=True)
    async def firstmessage(
        self, ctx: commands.Context, channel: Optional[GuildMessageable] = None
    ):
        """Link to the first message in the current or a given channel.

        The answer comes with a **Jump to first message** button, so it is
        clickable on desktop and mobile alike.
        """
        channel = channel or ctx.channel

        perms = channel.permissions_for(ctx.me)
        if not (perms.read_messages and perms.read_message_history):
            await ctx.send(f"🚫 I cannot read the history of {channel.mention}.")
            return
        # Don't let someone peek into a channel they cannot open themselves.
        author_perms = channel.permissions_for(ctx.author)
        if not author_perms.read_messages:
            await ctx.send(f"🚫 You don't have access to {channel.mention}.")
            return

        try:
            message: Optional[discord.Message] = await anext(
                aiter(channel.history(limit=1, oldest_first=True)), None
            )
        except (discord.Forbidden, discord.HTTPException):
            log.exception("Unable to read message history for channel %s", channel.id)
            await ctx.send(f"🚫 Unable to read the message history for {channel.mention}.")
            return

        if message is None:
            await ctx.send(f"🤷 {channel.mention} has no messages at all — nothing to jump to.")
            return

        view = _jump_view(message.jump_url)
        author = message.author

        # No Embed Links → an embed would be dropped entirely and the user would
        # see nothing. A bare URL in plain text auto-links, so use that instead.
        if not ctx.channel.permissions_for(ctx.me).embed_links or not await self.config.guild(
            ctx.guild
        ).use_embed():
            await ctx.send(
                f"⏫ **First message in {channel.mention}** — by **{author.display_name}** "
                f"({discord.utils.format_dt(message.created_at, 'R')})\n{message.jump_url}",
                view=view,
                allowed_mentions=discord.AllowedMentions.none(),
            )
            return

        embed = discord.Embed(
            color=EMBED_COLOR,
            # A linked title is clickable on its own, button or not.
            title=f"⏫ First message in #{channel.name}",
            url=message.jump_url,
            description=_preview(message),
            timestamp=message.created_at,
        )
        embed.set_author(name=author.display_name, icon_url=author.display_avatar.url)
        embed.add_field(
            name="Jump",
            # The raw URL: copyable, long-pressable, and readable in a quote.
            value=f"[Click here to jump]({message.jump_url})\n{message.jump_url}",
            inline=False,
        )
        embed.set_footer(text=f"Posted {channel.guild.name} · use the button below to jump")

        await ctx.send(embed=embed, view=view, allowed_mentions=discord.AllowedMentions.none())

    @commands.guild_only()
    @commands.admin_or_permissions(manage_guild=True)
    @commands.command(name="firstmessageembed")
    async def firstmessage_embed(self, ctx: commands.Context, on_off: bool):
        """Answer with an embed (on) or plain text with the link (off)."""
        await self.config.guild(ctx.guild).use_embed.set(on_off)
        await ctx.send(
            "✅ `firstmessage` answers with an embed."
            if on_off
            else "✅ `firstmessage` answers with plain text and a jump button."
        )
