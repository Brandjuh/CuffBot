"""CuffUnits — the metric/imperial desk.

The precinct runs on a mix of American and European officers, so "it's 72
outside" and "the limit is 100" mean different things to different people.
This cog watches chat and, when someone writes a quantity, quietly posts the
same figure in the other system.

Design notes worth knowing before changing anything:

* **Silence is the feature.** A bot that answers "see you at 10 in the morning"
  with "10 in = 25.4 cm" gets muted within a day. The detection rules live in
  ``units.py`` and are deliberately conservative — bare ``m``, ``g`` and ``in``
  are not units here.
* **It never answers someone who already answered themselves.** "72F (22C)"
  produces nothing, matched on the value rather than on the unit name.
* **Cooldown per channel**, so a burst of messages produces one reply, not ten.

Times are out of scope on purpose: those are Hammertime's job, and a clock
reading is not a unit conversion.
"""

import logging
import time
from typing import Dict, List, Optional

import discord
from redbot.core import Config, checks, commands

from .units import (
    FAMILIES,
    FAMILY_EMOJI,
    IMPERIAL_GALLON_L,
    US_GALLON_L,
    build_conversions,
)

log = logging.getLogger("red.cuff-cogs.cuffunits")

EMBED_COLOR = 0x3498DB
MAX_SCAN_CHARS = 2000


class CuffUnits(commands.Cog):
    """Automatic metric ⇄ imperial conversion for chat."""

    __version__ = "1.0.0"
    __author__ = "Brandjuh"

    def format_help_for_context(self, ctx: commands.Context) -> str:
        pre_processed = super().format_help_for_context(ctx)
        return f"{pre_processed}\nCog Version: {self.__version__}\nAuthor: {self.__author__}"

    def __init__(self, bot):
        self.bot = bot
        self.config = Config.get_conf(self, identifier=411157175010, force_registration=True)
        self.config.register_guild(
            enabled=True,
            families=list(FAMILIES),
            #: "all" watches everywhere, "allow" only the listed channels,
            #: "deny" everywhere except them.
            channel_mode="all",
            channels=[],
            ignored_roles=[],
            cooldown=15,
            max_per_message=4,
            imperial_gallon=False,
            skip_if_present=True,
            reply=True,
            delete_after=0,
        )
        #: channel id -> monotonic stamp of the last auto reply
        self._last_reply: Dict[int, float] = {}

    async def red_delete_data_for_user(self, *, requester, user_id: int):
        """Nothing is stored per user."""
        return

    # ------------------------------------------------------------------
    # Listener
    # ------------------------------------------------------------------

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        try:
            await self._maybe_convert(message)
        except Exception:
            # A chat message must never crash the gateway handler.
            log.warning("Units: conversion failed", exc_info=True)

    async def _watching(self, conf: dict, channel_id: int) -> bool:
        mode = conf["channel_mode"]
        listed = channel_id in conf["channels"]
        if mode == "allow":
            return listed
        if mode == "deny":
            return not listed
        return True

    async def _maybe_convert(self, message: discord.Message) -> None:
        if message.author.bot or message.guild is None:
            return
        content = (message.content or "")[:MAX_SCAN_CHARS]
        if not content or not any(char.isdigit() for char in content):
            return  # cheapest possible gate before touching Config

        conf = await self.config.guild(message.guild).all()
        if not conf["enabled"] or not await self._watching(conf, message.channel.id):
            return
        if any(role.id in conf["ignored_roles"] for role in getattr(message.author, "roles", [])):
            return
        # Never answer our own command invocations.
        prefixes = await self.bot.get_valid_prefixes(message.guild)
        stripped = content.lstrip()
        if any(stripped.startswith(prefix) for prefix in prefixes):
            return

        rows = build_conversions(
            content,
            families=conf["families"],
            gallon_litres=IMPERIAL_GALLON_L if conf["imperial_gallon"] else US_GALLON_L,
            limit=int(conf["max_per_message"]),
            skip_if_present=conf["skip_if_present"],
        )
        if not rows:
            return

        # Cooldown is per channel and only ticks when we actually reply, so a
        # quiet channel never has to wait.
        now = time.monotonic()
        last = self._last_reply.get(message.channel.id, 0.0)
        if now - last < float(conf["cooldown"]):
            return
        self._last_reply[message.channel.id] = now

        embed = self.build_embed(rows)
        delete_after = float(conf["delete_after"]) or None
        try:
            if conf["reply"]:
                await message.reply(embed=embed, mention_author=False, delete_after=delete_after)
            else:
                await message.channel.send(embed=embed, delete_after=delete_after)
        except discord.HTTPException as error:
            log.warning("Units: could not post a conversion: %s", error)

    @staticmethod
    def build_embed(rows: List[Dict[str, object]]) -> discord.Embed:
        """One tidy block, one line per quantity."""
        embed = discord.Embed(color=EMBED_COLOR)
        embed.description = "\n".join(
            f"{row['emoji']}  **{row['from']}**  →  **{row['to']}**" for row in rows
        )
        embed.set_footer(text="metric ⇄ imperial")
        return embed

    # ------------------------------------------------------------------
    # Manual conversion
    # ------------------------------------------------------------------

    @commands.guild_only()
    @commands.command(name="convert", aliases=["conv", "units"])
    async def convert_command(self, ctx: commands.Context, *, text: str):
        """Convert the units in a phrase, e.g. `[p]convert 72F and 15 gallons`.

        Works even when the channel is not being watched, and answers even if
        the message already contains both figures.
        """
        conf = await self.config.guild(ctx.guild).all()
        rows = build_conversions(
            text,
            families=conf["families"],
            gallon_litres=IMPERIAL_GALLON_L if conf["imperial_gallon"] else US_GALLON_L,
            limit=int(conf["max_per_message"]),
            skip_if_present=False,
        )
        if not rows:
            await ctx.send(
                "🤷 I found nothing to convert there. Try `72F`, `60 mph`, `15 gallons`, "
                "`100 km/h`, `6 feet`, `80 kg`."
            )
            return
        await ctx.send(embed=self.build_embed(rows))

    # ------------------------------------------------------------------
    # Settings
    # ------------------------------------------------------------------

    @commands.guild_only()
    @commands.group(name="unitset", aliases=["convertset"])
    @checks.admin_or_permissions(manage_guild=True)
    async def unitset(self, ctx: commands.Context):
        """Configure automatic unit conversion."""
        if ctx.invoked_subcommand is not None:
            return
        conf = await self.config.guild(ctx.guild).all()
        mode = conf["channel_mode"]
        where = {
            "all": "every channel",
            "allow": f"{len(conf['channels'])} listed channel(s) only",
            "deny": f"everywhere except {len(conf['channels'])} channel(s)",
        }[mode]
        on = [f"{FAMILY_EMOJI[f]} {f}" for f in FAMILIES if f in conf["families"]]
        off = [f for f in FAMILIES if f not in conf["families"]]
        lines = [
            "📐 **Unit conversion**",
            f"**Enabled:** {'yes' if conf['enabled'] else 'no'}",
            f"**Watching:** {where}",
            f"**Families on:** {', '.join(on) or 'none'}",
            f"**Families off:** {', '.join(off) or 'none'}",
            f"**Gallon:** {'imperial (4.546 L)' if conf['imperial_gallon'] else 'US (3.785 L)'}",
            f"**Cooldown:** {conf['cooldown']}s per channel · **max {conf['max_per_message']}** per message",
            f"**Skip if already converted:** {'yes' if conf['skip_if_present'] else 'no'}",
            f"**Style:** {'reply' if conf['reply'] else 'plain message'}"
            + (f", deleted after {conf['delete_after']}s" if conf["delete_after"] else ""),
            f"**Ignored roles:** {len(conf['ignored_roles'])}",
        ]
        await ctx.send("\n".join(lines))

    @unitset.command(name="on")
    async def unitset_on(self, ctx: commands.Context):
        """Turn automatic conversion on."""
        await self.config.guild(ctx.guild).enabled.set(True)
        await ctx.send("✅ Automatic conversion is **on**.")

    @unitset.command(name="off")
    async def unitset_off(self, ctx: commands.Context):
        """Turn automatic conversion off (`[p]convert` keeps working)."""
        await self.config.guild(ctx.guild).enabled.set(False)
        await ctx.send("📴 Automatic conversion is **off**. `convert` still works on demand.")

    @unitset.command(name="family")
    async def unitset_family(self, ctx: commands.Context, family: str, on_off: bool):
        """Turn one family on or off: temperature, speed, volume, distance, mass."""
        family = family.lower()
        if family not in FAMILIES:
            await ctx.send(f"🚫 Unknown family. Pick from: {', '.join(FAMILIES)}.")
            return
        async with self.config.guild(ctx.guild).families() as families:
            if on_off and family not in families:
                families.append(family)
            elif not on_off and family in families:
                families.remove(family)
        await ctx.send(
            f"✅ {FAMILY_EMOJI[family]} **{family}** is now {'on' if on_off else 'off'}."
        )

    @unitset.command(name="channels")
    async def unitset_channels(self, ctx: commands.Context, mode: str, *channels: discord.TextChannel):
        """Where to watch: `all`, `allow #a #b`, or `deny #a #b`."""
        mode = mode.lower()
        if mode not in ("all", "allow", "deny"):
            await ctx.send("🚫 Mode must be `all`, `allow` or `deny`.")
            return
        if mode != "all" and not channels:
            await ctx.send(f"🚫 Name at least one channel for `{mode}`.")
            return
        group = self.config.guild(ctx.guild)
        await group.channel_mode.set(mode)
        await group.channels.set([channel.id for channel in channels])
        if mode == "all":
            await ctx.send("✅ Watching **every** channel.")
        else:
            named = ", ".join(channel.mention for channel in channels)
            await ctx.send(
                f"✅ Watching **only** {named}." if mode == "allow"
                else f"✅ Watching everywhere **except** {named}."
            )

    @unitset.command(name="cooldown")
    async def unitset_cooldown(self, ctx: commands.Context, seconds: int):
        """Seconds between automatic replies in the same channel (0–600)."""
        if not 0 <= seconds <= 600:
            await ctx.send("🚫 Pick between **0** and **600** seconds.")
            return
        await self.config.guild(ctx.guild).cooldown.set(seconds)
        await ctx.send(f"✅ At most one conversion per **{seconds}s** per channel.")

    @unitset.command(name="max")
    async def unitset_max(self, ctx: commands.Context, count: int):
        """How many conversions one message may produce (1–10)."""
        if not 1 <= count <= 10:
            await ctx.send("🚫 Pick between **1** and **10**.")
            return
        await self.config.guild(ctx.guild).max_per_message.set(count)
        await ctx.send(f"✅ Up to **{count}** conversions per message.")

    @unitset.command(name="gallon")
    async def unitset_gallon(self, ctx: commands.Context, kind: str):
        """Which gallon: `us` (3.785 L) or `imperial` (4.546 L)."""
        kind = kind.lower()
        if kind not in ("us", "imperial", "uk"):
            await ctx.send("🚫 Pick `us` or `imperial`.")
            return
        imperial = kind in ("imperial", "uk")
        await self.config.guild(ctx.guild).imperial_gallon.set(imperial)
        await ctx.send(
            f"✅ Gallons are **{'imperial (4.546 L)' if imperial else 'US (3.785 L)'}**."
        )

    @unitset.command(name="skipconverted")
    async def unitset_skipconverted(self, ctx: commands.Context, on_off: bool):
        """Stay quiet when the author already gave both figures (default on)."""
        await self.config.guild(ctx.guild).skip_if_present.set(on_off)
        await ctx.send(
            "✅ Messages that already contain the conversion are left alone."
            if on_off
            else "✅ Every recognised quantity gets a conversion, even duplicates."
        )

    @unitset.command(name="style")
    async def unitset_style(self, ctx: commands.Context, kind: str):
        """`reply` (threaded under the message) or `message` (plain post)."""
        kind = kind.lower()
        if kind not in ("reply", "message"):
            await ctx.send("🚫 Pick `reply` or `message`.")
            return
        await self.config.guild(ctx.guild).reply.set(kind == "reply")
        await ctx.send(f"✅ Conversions are posted as a **{kind}**.")

    @unitset.command(name="deleteafter")
    async def unitset_deleteafter(self, ctx: commands.Context, seconds: int):
        """Auto-delete conversions after N seconds (0 keeps them)."""
        if not 0 <= seconds <= 3600:
            await ctx.send("🚫 Pick between **0** and **3600** seconds.")
            return
        await self.config.guild(ctx.guild).delete_after.set(seconds)
        await ctx.send(
            f"✅ Conversions vanish after **{seconds}s**." if seconds else "✅ Conversions stay."
        )

    @unitset.command(name="ignorerole")
    async def unitset_ignorerole(self, ctx: commands.Context, role: discord.Role):
        """Toggle a role whose members are never auto-converted."""
        async with self.config.guild(ctx.guild).ignored_roles() as roles:
            if role.id in roles:
                roles.remove(role.id)
                added = False
            else:
                roles.append(role.id)
                added = True
        await ctx.send(
            f"✅ **{role.name}** is now ignored." if added else f"✅ **{role.name}** is watched again."
        )

    @unitset.command(name="test")
    async def unitset_test(self, ctx: commands.Context, *, text: str):
        """See what the watcher would do with a phrase, without posting it."""
        conf = await self.config.guild(ctx.guild).all()
        rows = build_conversions(
            text,
            families=conf["families"],
            gallon_litres=IMPERIAL_GALLON_L if conf["imperial_gallon"] else US_GALLON_L,
            limit=int(conf["max_per_message"]),
            skip_if_present=conf["skip_if_present"],
        )
        if not rows:
            await ctx.send("🔇 Nothing would be posted for that message.")
            return
        await ctx.send(content="This is what would be posted:", embed=self.build_embed(rows))
