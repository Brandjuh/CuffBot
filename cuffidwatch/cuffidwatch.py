"""CuffIdWatch — get pinged and/or DM'd when your raw user ID is used.

A real @mention already notifies you; a raw ID pasted in chat, a ban list, or
another bot's modlog embed does not. Members opt in per channel-ping and/or
per-DM. Some members are pre-enrolled via DEFAULT_SEEDED (their own settings
win as soon as they touch a command).
"""

import logging
import re
import time
from typing import Dict, Iterable, Literal, Set, Tuple

import discord
from redbot.core import Config, checks, commands
from redbot.core.bot import Red

log = logging.getLogger("red.cuffcogs.cuffidwatch")

#: user id -> settings written ONCE at first load; ``seeded`` guards the write
#: so the member's own later choices are never overwritten.
DEFAULT_SEEDED = {
    132620654087241729: {"ping": True, "dm": True},
}

DEFAULT_USER = {
    "ping": False,
    "dm": False,
    "seeded": False,
}

#: per watched-user, per channel — one alert per this window, however many
#: messages repeat the ID.
COOLDOWN_SECONDS = 30

#: how much of the triggering message the DM quotes.
SNIPPET_LENGTH = 200

# Real mention/channel/role/emoji syntax is stripped before scanning: those IDs
# either already notify (user mentions) or are not user IDs at all.
_MARKUP_RE = re.compile(r"<(?:@!?|@&|#|a?:\w+:)\d{15,21}>")
_RAW_ID_RE = re.compile(r"(?<!\d)(\d{17,20})(?!\d)")


# --------------------------------------------------------------------- #
# Pure helpers — text in, IDs out, testable without discord objects.     #
# --------------------------------------------------------------------- #


def extract_ids(text: str) -> Set[int]:
    """Raw user-ID-shaped numbers in ``text``, mention markup excluded."""
    if not text:
        return set()
    return {int(m) for m in _RAW_ID_RE.findall(_MARKUP_RE.sub(" ", text))}


def embed_text(embed: discord.Embed) -> str:
    """Every human-readable string of an embed, joined for scanning."""
    parts = [
        embed.title or "",
        embed.description or "",
        (embed.footer.text or "") if embed.footer else "",
        (embed.author.name or "") if embed.author else "",
    ]
    for field in embed.fields:
        parts.append(field.name or "")
        parts.append(field.value or "")
    return "\n".join(p for p in parts if p)


def harvest_ids(content: str, embeds: Iterable[discord.Embed]) -> Set[int]:
    """All raw IDs used in a message: plain content plus its embeds."""
    found = extract_ids(content)
    for embed in embeds:
        found |= extract_ids(embed_text(embed))
    return found


def snippet(content: str, limit: int = SNIPPET_LENGTH) -> str:
    text = " ".join(content.split())
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


class CuffIdWatch(commands.Cog):
    """Ping and/or DM members when their raw user ID is used in chat."""

    def __init__(self, bot: Red):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=0x1D3A7C41, force_registration=True)
        self.config.register_user(**DEFAULT_USER)
        #: user id -> {"ping": bool, "dm": bool}; only users with at least one
        #: alert enabled — the on_message hot path never touches Config.
        self._watched: Dict[int, Dict[str, bool]] = {}
        #: (watched user id, channel id) -> monotonic time of the last alert.
        self._last_alert: Dict[Tuple[int, int], float] = {}

    async def cog_load(self) -> None:
        for uid, wanted in DEFAULT_SEEDED.items():
            conf = self.config.user_from_id(uid)
            if not await conf.seeded():
                await conf.ping.set(wanted["ping"])
                await conf.dm.set(wanted["dm"])
                await conf.seeded.set(True)
                log.info("Seeded id-watch for %s: %s", uid, wanted)
        all_users = await self.config.all_users()
        self._watched = {
            uid: {"ping": data["ping"], "dm": data["dm"]}
            for uid, data in all_users.items()
            if data.get("ping") or data.get("dm")
        }
        log.info("Watching %d user id(s).", len(self._watched))

    async def red_delete_data_for_user(
        self,
        *,
        requester: Literal["discord_deleted_user", "owner", "user", "user_strict"],
        user_id: int,
    ) -> None:
        await self.config.user_from_id(user_id).clear()
        self._watched.pop(user_id, None)

    # ------------------------------------------------------------- listener

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message) -> None:
        if not self._watched or message.guild is None:
            return
        if self.bot.user is not None and message.author.id == self.bot.user.id:
            return  # our own alerts contain the mention — never re-trigger
        if await self.bot.cog_disabled_in_guild(self, message.guild):
            return

        found = harvest_ids(message.content, message.embeds)
        if not found:
            return

        now = time.monotonic()
        for uid in found & self._watched.keys():
            if uid == message.author.id:
                continue  # using your own ID is not news
            member = message.guild.get_member(uid)
            if member is None:
                continue
            if not message.channel.permissions_for(member).read_messages:
                continue  # never leak channels the member cannot see
            key = (uid, message.channel.id)
            if now - self._last_alert.get(key, -COOLDOWN_SECONDS) < COOLDOWN_SECONDS:
                continue
            self._last_alert[key] = now
            settings = self._watched[uid]
            if settings["ping"]:
                await self._send_ping(message, member)
            if settings["dm"]:
                await self._send_dm(message, member)

    async def _send_ping(self, message: discord.Message, member: discord.Member) -> None:
        try:
            await message.channel.send(
                f"📟 {member.mention} — your user ID was used by "
                f"{message.author.display_name} ({message.jump_url})",
                allowed_mentions=discord.AllowedMentions(
                    users=[member], everyone=False, roles=False
                ),
            )
        except discord.HTTPException:
            log.warning("Could not ping %s in #%s", member, message.channel, exc_info=True)

    async def _send_dm(self, message: discord.Message, member: discord.Member) -> None:
        embed = discord.Embed(
            title="📟 Your user ID was used",
            description=snippet(message.content) or "*(embed content)*",
            color=discord.Color.blurple(),
        )
        embed.add_field(name="By", value=f"{message.author} ({message.author.mention})")
        embed.add_field(name="Where", value=message.channel.mention)
        embed.add_field(name="Jump", value=f"[Go to message]({message.jump_url})", inline=False)
        try:
            await member.send(embed=embed)
        except discord.HTTPException:
            log.info("Could not DM %s (closed DMs?)", member)

    # ------------------------------------------------------------- commands

    async def _set(self, ctx: commands.Context, *, ping=None, dm=None) -> None:
        conf = self.config.user(ctx.author)
        if ping is not None:
            await conf.ping.set(ping)
        if dm is not None:
            await conf.dm.set(dm)
        await conf.seeded.set(True)
        data = await conf.all()
        if data["ping"] or data["dm"]:
            self._watched[ctx.author.id] = {"ping": data["ping"], "dm": data["dm"]}
        else:
            self._watched.pop(ctx.author.id, None)

    @staticmethod
    def _status_line(data: Dict[str, bool]) -> str:
        return (
            f"channel ping **{'on' if data['ping'] else 'off'}** · "
            f"DM **{'on' if data['dm'] else 'off'}**"
        )

    @commands.guild_only()
    @commands.group(invoke_without_command=True)
    async def idwatch(self, ctx: commands.Context) -> None:
        """Alerts when someone uses your raw user ID.

        A real @mention already notifies you — this covers pasted IDs in
        messages, ban lists and other bots' log embeds.
        """
        data = await self.config.user(ctx.author).all()
        await ctx.send(f"🔎 Your ID watch: {self._status_line(data)}")

    @idwatch.command(name="ping")
    async def idwatch_ping(self, ctx: commands.Context, on_off: bool) -> None:
        """Turn the in-channel ping on or off."""
        await self._set(ctx, ping=on_off)
        await ctx.send(f"📟 Channel ping **{'on' if on_off else 'off'}**.")

    @idwatch.command(name="dm")
    async def idwatch_dm(self, ctx: commands.Context, on_off: bool) -> None:
        """Turn the DM alert on or off."""
        await self._set(ctx, dm=on_off)
        await ctx.send(f"📨 DM alert **{'on' if on_off else 'off'}**.")

    @idwatch.command(name="on")
    async def idwatch_on(self, ctx: commands.Context) -> None:
        """Turn both the ping and the DM alert on."""
        await self._set(ctx, ping=True, dm=True)
        await ctx.send("🔎 ID watch fully **on** (ping + DM).")

    @idwatch.command(name="off")
    async def idwatch_off(self, ctx: commands.Context) -> None:
        """Turn all your ID alerts off."""
        await self._set(ctx, ping=False, dm=False)
        await ctx.send("🔕 ID watch **off**.")

    @commands.guild_only()
    @checks.admin_or_permissions(manage_guild=True)
    @commands.group()
    async def idwatchset(self, ctx: commands.Context) -> None:
        """Admin tools for the ID watch."""

    @idwatchset.command(name="list")
    async def idwatchset_list(self, ctx: commands.Context) -> None:
        """Everyone with an ID alert enabled."""
        if not self._watched:
            await ctx.send("Nobody is watching their ID.")
            return
        lines = []
        for uid, data in sorted(self._watched.items()):
            member = ctx.guild.get_member(uid)
            name = member.display_name if member else f"`{uid}` (not in guild)"
            lines.append(f"• {name} — {self._status_line(data)}")
        await ctx.send("🔎 **ID watch**\n" + "\n".join(lines))

    @idwatchset.command(name="user")
    async def idwatchset_user(
        self, ctx: commands.Context, user: discord.User, ping: bool, dm: bool
    ) -> None:
        """Set someone's ID alerts for them (ping and DM, in that order)."""
        conf = self.config.user(user)
        await conf.ping.set(ping)
        await conf.dm.set(dm)
        await conf.seeded.set(True)
        if ping or dm:
            self._watched[user.id] = {"ping": ping, "dm": dm}
        else:
            self._watched.pop(user.id, None)
        await ctx.send(
            f"🔎 {user.mention}: {self._status_line({'ping': ping, 'dm': dm})}",
            allowed_mentions=discord.AllowedMentions.none(),
        )
