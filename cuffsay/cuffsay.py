"""CuffSay — let moderators speak through the bot.

``!say <text>`` makes the bot repeat the text in the same channel with no
attribution, then deletes the invoking message so the author stays invisible.
Attachments are forwarded along with the text.
"""

import logging

import discord
from redbot.core import checks, commands
from redbot.core.bot import Red

log = logging.getLogger("red.cuffcogs.cuffsay")

#: Discord's hard cap; longer input is refused, not silently truncated.
MAX_LENGTH = 2000


class CuffSay(commands.Cog):
    """Speak through the bot: repeat a message anonymously and hide the source."""

    def __init__(self, bot: Red):
        self.bot = bot

    async def red_delete_data_for_user(self, **kwargs) -> None:
        """Nothing stored."""

    @commands.guild_only()
    @checks.mod_or_permissions(manage_messages=True)
    @commands.command()
    async def say(self, ctx: commands.Context, *, text: str = "") -> None:
        """Make the bot say something here, without naming who typed it.

        The invoking message is deleted afterwards. Attachments are
        forwarded too.
        """
        files = [
            await attachment.to_file()
            for attachment in ctx.message.attachments[:10]
        ]
        if not text and not files:
            await ctx.send("Give me something to say: `!say <text>`.", delete_after=10)
            await self._delete_invocation(ctx)
            return
        if len(text) > MAX_LENGTH:
            await ctx.send(
                f"That is {len(text) - MAX_LENGTH} characters over Discord's "
                f"{MAX_LENGTH}-character limit.",
                delete_after=10,
            )
            await self._delete_invocation(ctx)
            return

        # Users may be pinged on purpose; @everyone/@here and role pings stay
        # off so the bot cannot be used to mass-ping past someone's own perms.
        try:
            await ctx.send(
                text or None,
                files=files or None,
                allowed_mentions=discord.AllowedMentions(
                    users=True, everyone=False, roles=False
                ),
            )
        except discord.HTTPException:
            log.warning("say failed in #%s", ctx.channel, exc_info=True)
            return  # keep the invoking message so the text is not lost

        await self._delete_invocation(ctx)

    @staticmethod
    async def _delete_invocation(ctx: commands.Context) -> None:
        try:
            await ctx.message.delete()
        except discord.NotFound:
            pass  # already gone
        except discord.Forbidden:
            log.warning(
                "Missing manage_messages in #%s — cannot hide the invoker.",
                ctx.channel,
            )
